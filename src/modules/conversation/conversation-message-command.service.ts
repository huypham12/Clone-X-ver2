import { MongoServerError, type ClientSession, type Document, type ObjectId } from 'mongodb'
import { createHash } from 'crypto'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { ConversationSystemEventType, MediaStatus, MediaType, MessageKind } from '~/constants/enums'
import Message from '~/schemas/Message.schema'
import type MediaMetadata from '~/schemas/MediaMetadata.schema'
import { DomainAggregateType, DomainEventType, type MessageCreatedEvent } from '~/modules/events/domain-event.type'
import { OutboxDomainEventPublisher } from '~/modules/events/outbox.publisher'
import type { TransactionalDomainEventPublisher } from '~/modules/events/domain-event.publisher'
import type { OutboxInsertResult } from '~/modules/events/outbox.repository'
import conversationReadService, {
  ConversationReadService,
  type ConversationReadMutationResult,
  type MessageUnreadInput
} from './conversation-read.service'
import type { ConversationType } from './conversation-access.service'
import conversationMessageMentionService, {
  ConversationMessageMentionService
} from './conversation-message-mention.service'

type MessageMediaType = MediaType.Image | MediaType.Video | MediaType.Audio
export type MessagePreviewType = 'text' | MessageMediaType
export const CLIENT_MESSAGE_ID_CONFLICT_CODE = 'CLIENT_MESSAGE_ID_CONFLICT'

export interface SendMessageCommand {
  sender_id: string
  conversation_id: string
  conversation_type: ConversationType
  content?: string
  media_ids?: string[]
  reply_to_message_id?: string
  mention_user_ids?: string[]
  client_message_id?: string
}

export interface ForwardMessageCommand {
  sender_id: string
  origin_message_id: string
  conversation_ids: string[]
  client_operation_id?: string
}

export interface SystemMessageCommand {
  actor_id: ObjectId
  conversation_id: ObjectId
  system_event_type: ConversationSystemEventType
  affected_user_ids: ObjectId[]
  recipient_ids: ObjectId[]
  content: string
  context: Record<string, unknown>
  occurred_at: Date
}

export interface MessageCommandResult {
  created: boolean
  message: Message
  medias_info: MediaMetadata[]
  member_ids: string[]
  read_mutations: ConversationReadMutationResult[]
}

type PreparedMessage = {
  message: Message
  medias_info: MediaMetadata[]
  member_ids: string[]
  preview_type: MessagePreviewType
}

const isMessageMediaType = (type: MediaType): type is MessageMediaType =>
  type === MediaType.Image || type === MediaType.Video || type === MediaType.Audio

const getPendingHistoryRestoreUserIds = {
  $map: {
    input: {
      $filter: {
        input: { $ifNull: ['$history_cleared_by', []] },
        as: 'marker',
        cond: { $eq: ['$$marker.restore_on_next_message', true] }
      }
    },
    as: 'marker',
    in: '$$marker.user_id'
  }
}

export class ConversationMessageCommandService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly outboxPublisher: TransactionalDomainEventPublisher<OutboxInsertResult> = new OutboxDomainEventPublisher(),
    private readonly readService: ConversationReadService = conversationReadService,
    private readonly mentionService: ConversationMessageMentionService = conversationMessageMentionService
  ) {}

  async send(command: SendMessageCommand): Promise<MessageCommandResult> {
    const normalized = this.normalizeSendCommand(command)
    if (normalized.client_message_id) {
      const existing = await this.findByClientMessageId(normalized.sender_id, normalized.client_message_id)
      if (existing) return this.loadExistingResult(existing, normalized)
    }

    const session = this.databaseService.startSession()
    try {
      let result: MessageCommandResult | undefined
      await session.withTransaction(async () => {
        if (normalized.client_message_id) {
          const existing = await this.findByClientMessageId(normalized.sender_id, normalized.client_message_id, session)
          if (existing) {
            result = await this.loadExistingResult(existing, normalized, session)
            return
          }
        }
        const prepared = await this.prepareNewMessage(normalized, false, session)
        const [created] = await this.persistPrepared([prepared], session)
        result = created
      })
      if (!result) throw new Error('Message transaction returned no result')
      return result
    } catch (error: unknown) {
      if (normalized.client_message_id && error instanceof MongoServerError && error.code === 11000) {
        const existing = await this.findByClientMessageId(normalized.sender_id, normalized.client_message_id)
        if (existing) return this.loadExistingResult(existing, normalized)
      }
      throw error
    } finally {
      await session.endSession()
    }
  }

  async forward(command: ForwardMessageCommand): Promise<MessageCommandResult[]> {
    const normalizedConversationIds = [
      ...new Set(
        command.conversation_ids.map((conversationId) => {
          if (!this.databaseService.ObjectId.isValid(conversationId)) {
            throw new HttpError('Invalid conversation ID', HTTP_STATUS.BAD_REQUEST)
          }
          return new this.databaseService.ObjectId(conversationId).toHexString()
        })
      )
    ]
    if (normalizedConversationIds.length === 0) {
      throw new HttpError('At least one conversation is required', HTTP_STATUS.BAD_REQUEST)
    }
    const operationId = command.client_operation_id?.trim()
    if (operationId !== undefined && (operationId.length === 0 || operationId.length > 128)) {
      throw new HttpError('client_operation_id must contain 1 to 128 characters', HTTP_STATUS.BAD_REQUEST)
    }

    const session = this.databaseService.startSession()
    try {
      let results: MessageCommandResult[] | undefined
      await session.withTransaction(async () => {
        const senderId = new this.databaseService.ObjectId(command.sender_id)
        const originId = new this.databaseService.ObjectId(command.origin_message_id)
        const origin = await this.databaseService.messages.findOne({ _id: originId }, { session })
        if (!origin) throw new HttpError('Original message not found', HTTP_STATUS.NOT_FOUND)
        await this.assertSourceVisible(origin, senderId, session)

        const medias = origin.media_ids.length
          ? await this.databaseService.medias.find({ _id: { $in: origin.media_ids } }, { session }).toArray()
          : []
        if (medias.length !== origin.media_ids.length || medias.some((media) => media.status !== MediaStatus.Ready)) {
          throw new HttpError('Original message media is unavailable', HTTP_STATUS.BAD_REQUEST)
        }
        const mediaById = new Map(medias.map((media) => [media._id.toHexString(), media]))
        const orderedMedias = origin.media_ids.map((mediaId) => {
          const media = mediaById.get(mediaId.toHexString())
          if (!media) throw new HttpError('Original message media is unavailable', HTTP_STATUS.BAD_REQUEST)
          return media
        })

        const prepared: PreparedMessage[] = []
        const existingResults: MessageCommandResult[] = []
        for (const conversationId of normalizedConversationIds) {
          const clientMessageId = operationId ? `${operationId}:${conversationId}` : undefined
          if (clientMessageId && clientMessageId.length > 256) {
            throw new HttpError('Derived forward idempotency key is too long', HTTP_STATUS.BAD_REQUEST)
          }
          const normalized = this.normalizeSendCommand({
            sender_id: command.sender_id,
            conversation_id: conversationId,
            conversation_type: await this.resolveConversationType(senderId, conversationId, session),
            content: origin.content,
            media_ids: origin.media_ids.map((id) => id.toHexString()),
            client_message_id: clientMessageId
          })
          if (clientMessageId) {
            const existing = await this.findByClientMessageId(senderId, clientMessageId, session)
            if (existing) {
              this.assertMessageIdentity(existing, normalized, origin._id)
              existingResults.push(await this.loadExistingResult(existing, normalized, session))
              continue
            }
          }
          prepared.push(
            await this.prepareNewMessage(normalized, true, session, {
              origin_message_id: origin._id as ObjectId,
              medias_info: orderedMedias
            })
          )
        }
        const createdResults = await this.persistPrepared(prepared, session)
        results = [...existingResults, ...createdResults]
      })
      if (!results) throw new Error('Forward transaction returned no result')
      return results
    } catch (error: unknown) {
      if (operationId && error instanceof MongoServerError && error.code === 11000) {
        return this.loadExistingForwardResults(command, normalizedConversationIds, operationId)
      }
      throw error
    } finally {
      await session.endSession()
    }
  }

  async sendSystemInTransaction(command: SystemMessageCommand, session: ClientSession): Promise<MessageCommandResult> {
    if (!session.inTransaction())
      throw new Error('System message must be created inside the group mutation transaction')

    const group = await this.databaseService.groupConversations.findOne(
      { _id: command.conversation_id },
      { projection: { members: 1 }, session }
    )
    if (!group) throw new HttpError('Group conversation not found', HTTP_STATUS.NOT_FOUND)

    const currentMemberIds = group.members.map((member) => member.user_id)
    const expectedRecipients = new Set(command.recipient_ids.map((id) => id.toHexString()))
    const membershipMatches =
      expectedRecipients.size === currentMemberIds.length &&
      currentMemberIds.every((id) => expectedRecipients.has(id.toHexString()))
    if (!membershipMatches) {
      throw new HttpError(
        'Group membership changed; refresh and try again',
        HTTP_STATUS.CONFLICT,
        undefined,
        'GROUP_MEMBERSHIP_CHANGED'
      )
    }

    const message = new Message({
      _id: new this.databaseService.ObjectId(),
      conversation_id: command.conversation_id,
      conversation_type: 'group',
      sender_id: command.actor_id,
      kind: MessageKind.System,
      system_event_type: command.system_event_type,
      affected_user_ids: command.affected_user_ids,
      context: command.context,
      content: command.content,
      media_ids: [],
      send_at: command.occurred_at,
      mention_user_ids: [],
      is_forwarded: false,
      status: 'sent',
      reactions: []
    })
    await this.databaseService.messages.insertOne(message, { session })
    const updateResult = await this.databaseService.groupConversations.updateOne(
      {
        _id: command.conversation_id,
        $expr: {
          $setEquals: ['$members.user_id', currentMemberIds]
        }
      },
      {
        $set: {
          last_message_at: command.occurred_at,
          last_message_preview: {
            message_id: message._id,
            sender_id: command.actor_id,
            content: command.content.substring(0, 50),
            message_type: 'text'
          },
          last_message_overrides: [],
          updated_at: command.occurred_at
        }
      },
      { session }
    )
    if (updateResult.matchedCount !== 1) {
      throw new HttpError(
        'Group membership changed; refresh and try again',
        HTTP_STATUS.CONFLICT,
        undefined,
        'GROUP_MEMBERSHIP_CHANGED'
      )
    }

    const readMutations = await this.readService.incrementForMessages(
      [
        {
          message_id: message._id as ObjectId,
          conversation_id: command.conversation_id,
          conversation_type: 'group',
          sender_id: command.actor_id,
          recipient_ids: currentMemberIds,
          occurred_at: command.occurred_at
        }
      ],
      session
    )
    return {
      created: true,
      message,
      medias_info: [],
      member_ids: currentMemberIds.map((id) => id.toHexString()),
      read_mutations: readMutations
    }
  }

  private normalizeSendCommand(
    command: SendMessageCommand
  ): Required<Pick<SendMessageCommand, 'sender_id' | 'conversation_id' | 'conversation_type'>> &
    Omit<SendMessageCommand, 'sender_id' | 'conversation_id' | 'conversation_type'> {
    const content = command.content?.trim() ?? ''
    const mediaIds = command.media_ids ?? []
    const uniqueMediaIds = [...new Set(mediaIds)]
    if (
      (!content && uniqueMediaIds.length === 0) ||
      uniqueMediaIds.length !== mediaIds.length ||
      uniqueMediaIds.length > 4
    ) {
      throw new HttpError(
        'A message must contain text or up to 4 unique media files',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        'INVALID_MESSAGE_CONTENT'
      )
    }
    if (uniqueMediaIds.some((id) => !this.databaseService.ObjectId.isValid(id))) {
      throw new HttpError(
        'One or more media IDs are invalid',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        'INVALID_MESSAGE_PAYLOAD'
      )
    }
    const clientMessageId = command.client_message_id?.trim()
    if (clientMessageId !== undefined && (clientMessageId.length === 0 || clientMessageId.length > 256)) {
      throw new HttpError(
        'client_message_id must contain 1 to 256 characters',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        'INVALID_MESSAGE_PAYLOAD'
      )
    }
    const rawMentionIds = command.mention_user_ids ?? []
    if (
      rawMentionIds.length > envConfig.conversation.maxGroupMembers ||
      rawMentionIds.some((id) => !this.databaseService.ObjectId.isValid(id))
    ) {
      throw new HttpError(
        'mention_user_ids must contain valid user IDs within the group member limit',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        'INVALID_MESSAGE_PAYLOAD'
      )
    }
    const mentionUserIds = [...new Set(rawMentionIds.map((id) => new this.databaseService.ObjectId(id).toHexString()))]
    return {
      ...command,
      content,
      media_ids: uniqueMediaIds,
      mention_user_ids: mentionUserIds,
      client_message_id: clientMessageId
    }
  }

  private async prepareNewMessage(
    command: ReturnType<ConversationMessageCommandService['normalizeSendCommand']>,
    isForwarded: boolean,
    session: ClientSession,
    forward?: { origin_message_id: ObjectId; medias_info: MediaMetadata[] }
  ): Promise<PreparedMessage> {
    const senderId = new this.databaseService.ObjectId(command.sender_id)
    const conversationId = new this.databaseService.ObjectId(command.conversation_id)
    const access = await this.resolveConversation(senderId, conversationId, command.conversation_type, session)
    if (access.type === 'direct') await this.assertDirectAllowed(senderId, access.member_ids, session)

    let mediasInfo = forward?.medias_info ?? []
    if (!forward && command.media_ids && command.media_ids.length > 0) {
      const mediaObjectIds = command.media_ids.map((id) => new this.databaseService.ObjectId(id))
      const medias = await this.databaseService.medias.find({ _id: { $in: mediaObjectIds } }, { session }).toArray()
      const byId = new Map(medias.map((media) => [media._id.toHexString(), media]))
      mediasInfo = command.media_ids.map((id) => {
        const media = byId.get(id)
        const supported = media ? isMessageMediaType(media.type) : false
        if (
          !media ||
          media.uploaded_by?.toHexString() !== senderId.toHexString() ||
          media.status !== MediaStatus.Ready ||
          !media.url ||
          !supported
        ) {
          throw new HttpError(
            'One or more media files are invalid or not ready',
            HTTP_STATUS.BAD_REQUEST,
            undefined,
            'INVALID_MESSAGE_MEDIA'
          )
        }
        return media
      })
    }

    let replyId: ObjectId | undefined
    if (command.reply_to_message_id) {
      replyId = new this.databaseService.ObjectId(command.reply_to_message_id)
      const reply = await this.databaseService.messages.findOne(
        {
          _id: replyId,
          conversation_id: conversationId,
          conversation_type: command.conversation_type,
          status: 'sent',
          kind: { $ne: MessageKind.System },
          deleted_by: { $ne: senderId }
        },
        { session }
      )
      const isBeforeHistoryCutoff = Boolean(
        access.history_cutoff && replyId.toHexString() <= access.history_cutoff.toHexString()
      )
      if (!reply || isBeforeHistoryCutoff) {
        throw new HttpError(
          'The message you are replying to is unavailable in this conversation',
          HTTP_STATUS.BAD_REQUEST,
          undefined,
          'REPLY_MESSAGE_UNAVAILABLE'
        )
      }
    }

    const mentionUserIds =
      command.conversation_type === 'group'
        ? await this.mentionService.resolve(
            command.content ?? '',
            command.mention_user_ids ?? [],
            senderId,
            access.member_ids,
            session
          )
        : []

    const firstMediaType = mediasInfo[0]?.type
    const previewType: MessagePreviewType =
      firstMediaType && isMessageMediaType(firstMediaType) ? firstMediaType : 'text'
    const message = new Message({
      _id: new this.databaseService.ObjectId(),
      conversation_id: conversationId,
      conversation_type: command.conversation_type,
      sender_id: senderId,
      kind: MessageKind.User,
      content: command.content ?? '',
      media_ids: command.media_ids?.map((id) => new this.databaseService.ObjectId(id)) ?? [],
      send_at: new Date(),
      reply_to_message_id: replyId,
      mention_user_ids: mentionUserIds,
      client_message_id: command.client_message_id,
      client_payload_hash: command.client_message_id
        ? this.createClientPayloadHash(command, forward?.origin_message_id)
        : undefined,
      origin_message_id: forward?.origin_message_id,
      is_forwarded: isForwarded,
      status: 'sent',
      reactions: []
    })
    return { message, medias_info: mediasInfo, member_ids: access.member_ids, preview_type: previewType }
  }

  private async persistPrepared(prepared: PreparedMessage[], session: ClientSession): Promise<MessageCommandResult[]> {
    if (prepared.length === 0) return []
    await this.databaseService.messages.insertMany(
      prepared.map((item) => item.message),
      { session }
    )

    for (const item of prepared) {
      const message = item.message
      if (!message._id || !message.send_at) throw new Error('Prepared message is missing persistence identity')
      const preview = {
        message_id: message._id,
        sender_id: message.sender_id,
        content: message.content.substring(0, 50),
        message_type: item.preview_type
      }
      const updatePipeline: Document[] = [
        {
          $set: {
            last_message_at: message.send_at,
            last_message_preview: preview,
            last_message_overrides: [],
            hidden_by: {
              $filter: {
                input: { $ifNull: ['$hidden_by', []] },
                as: 'hiddenUserId',
                cond: { $eq: [{ $in: ['$$hiddenUserId', getPendingHistoryRestoreUserIds] }, false] }
              }
            },
            history_cleared_by: {
              $map: {
                input: { $ifNull: ['$history_cleared_by', []] },
                as: 'marker',
                in: {
                  $cond: [
                    { $eq: ['$$marker.restore_on_next_message', true] },
                    { $mergeObjects: ['$$marker', { restore_on_next_message: false }] },
                    '$$marker'
                  ]
                }
              }
            },
            muted_by: {
              $filter: {
                input: { $ifNull: ['$muted_by', []] },
                as: 'mute',
                cond: { $eq: [{ $in: ['$$mute.user_id', getPendingHistoryRestoreUserIds] }, false] }
              }
            },
            updated_at: message.send_at
          }
        }
      ]
      const updateResult =
        message.conversation_type === 'direct'
          ? await this.databaseService.directConversations.updateOne(
              {
                _id: message.conversation_id,
                $or: [{ user1_id: message.sender_id }, { user2_id: message.sender_id }]
              },
              updatePipeline,
              { session }
            )
          : await this.databaseService.groupConversations.updateOne(
              { _id: message.conversation_id, 'members.user_id': message.sender_id },
              updatePipeline,
              { session }
            )
      if (updateResult.matchedCount !== 1) {
        throw new HttpError('You are no longer a member of this conversation', HTTP_STATUS.FORBIDDEN)
      }

      const recipientIds = item.member_ids.map((id) => new this.databaseService.ObjectId(id))
      const event: MessageCreatedEvent = {
        event_id: `message-created:${message._id.toHexString()}`,
        type: DomainEventType.MessageCreated,
        aggregate_type: DomainAggregateType.Message,
        aggregate_id: message._id,
        actor_id: message.sender_id,
        payload: {
          message_id: message._id,
          conversation_id: message.conversation_id,
          conversation_type: message.conversation_type,
          recipient_ids: recipientIds.filter((id) => !id.equals(message.sender_id)),
          reply_to_message_id: message.reply_to_message_id ?? null,
          mention_user_ids: message.mention_user_ids,
          source_type: 'MESSAGE',
          source_id: message._id.toHexString()
        },
        occurred_at: message.send_at
      }
      await this.outboxPublisher.publish(event, { session })
    }

    const unreadInputs: MessageUnreadInput[] = prepared.map((item) => {
      const message = item.message
      if (!message._id || !message.send_at) throw new Error('Prepared message is missing unread identity')
      return {
        message_id: message._id,
        conversation_id: message.conversation_id,
        conversation_type: message.conversation_type,
        sender_id: message.sender_id,
        recipient_ids: item.member_ids.map((id) => new this.databaseService.ObjectId(id)),
        occurred_at: message.send_at
      }
    })
    const readMutations = await this.readService.incrementForMessages(unreadInputs, session)

    return prepared.map((item) => ({
      created: true,
      message: item.message,
      medias_info: item.medias_info,
      member_ids: item.member_ids,
      read_mutations: readMutations.filter((mutation) =>
        mutation.read_state.conversation_id.equals(item.message.conversation_id)
      )
    }))
  }

  private async resolveConversation(
    senderId: ObjectId,
    conversationId: ObjectId,
    expectedType: ConversationType,
    session?: ClientSession
  ): Promise<{ type: ConversationType; member_ids: string[]; history_cutoff?: ObjectId }> {
    if (expectedType === 'direct') {
      const conversation = await this.databaseService.directConversations.findOne(
        { _id: conversationId, $or: [{ user1_id: senderId }, { user2_id: senderId }] },
        { session }
      )
      if (!conversation) {
        throw new HttpError(
          'Conversation not found or access denied',
          HTTP_STATUS.FORBIDDEN,
          undefined,
          'CONVERSATION_ACCESS_DENIED'
        )
      }
      return {
        type: 'direct',
        member_ids: [conversation.user1_id.toHexString(), conversation.user2_id.toHexString()],
        history_cutoff:
          conversation.history_cleared_by.find((marker) => marker.user_id.equals(senderId))
            ?.cleared_through_message_id ?? undefined
      }
    }
    const conversation = await this.databaseService.groupConversations.findOne(
      { _id: conversationId, 'members.user_id': senderId },
      { session }
    )
    if (!conversation) {
      throw new HttpError(
        'Conversation not found or access denied',
        HTTP_STATUS.FORBIDDEN,
        undefined,
        'CONVERSATION_ACCESS_DENIED'
      )
    }
    return {
      type: 'group',
      member_ids: conversation.members.map((member) => member.user_id.toHexString()),
      history_cutoff:
        conversation.history_cleared_by.find((marker) => marker.user_id.equals(senderId))?.cleared_through_message_id ??
        undefined
    }
  }

  private async resolveConversationType(
    senderId: ObjectId,
    conversationId: string,
    session?: ClientSession
  ): Promise<ConversationType> {
    const id = new this.databaseService.ObjectId(conversationId)
    const direct = await this.databaseService.directConversations.findOne(
      { _id: id, $or: [{ user1_id: senderId }, { user2_id: senderId }] },
      { session, projection: { _id: 1 } }
    )
    if (direct) return 'direct'
    const group = await this.databaseService.groupConversations.findOne(
      { _id: id, 'members.user_id': senderId },
      { session, projection: { _id: 1 } }
    )
    if (group) return 'group'
    throw new HttpError(
      'Conversation not found or access denied',
      HTTP_STATUS.FORBIDDEN,
      undefined,
      'CONVERSATION_ACCESS_DENIED'
    )
  }

  private async assertDirectAllowed(senderId: ObjectId, memberIds: string[], session: ClientSession): Promise<void> {
    const partnerId = memberIds.find((id) => id !== senderId.toHexString())
    if (!partnerId) throw new HttpError('Direct conversation partner not found', HTTP_STATUS.NOT_FOUND)
    const partnerObjectId = new this.databaseService.ObjectId(partnerId)
    const block = await this.databaseService.userBlocks.findOne(
      {
        $or: [
          { user_id: senderId, blocked_user_id: partnerObjectId },
          { user_id: partnerObjectId, blocked_user_id: senderId }
        ]
      },
      { session, projection: { _id: 1 } }
    )
    if (block)
      throw new HttpError(
        'Direct messaging is unavailable because one user blocked the other',
        HTTP_STATUS.FORBIDDEN,
        undefined,
        'DIRECT_MESSAGE_BLOCKED'
      )
  }

  private async assertSourceVisible(message: Message, senderId: ObjectId, session: ClientSession): Promise<void> {
    if (
      message.kind === MessageKind.System ||
      message.status !== 'sent' ||
      message.deleted_by.some((id) => id.equals(senderId))
    ) {
      throw new HttpError('Message is not available for this action', HTTP_STATUS.BAD_REQUEST)
    }
    const access = await this.resolveConversation(senderId, message.conversation_id, message.conversation_type, session)
    if (access.history_cutoff && message._id && message._id.toHexString() <= access.history_cutoff.toHexString()) {
      throw new HttpError('Message is not available for this action', HTTP_STATUS.BAD_REQUEST)
    }
  }

  private async findByClientMessageId(senderId: string | ObjectId, clientMessageId: string, session?: ClientSession) {
    const senderObjectId = typeof senderId === 'string' ? new this.databaseService.ObjectId(senderId) : senderId
    return this.databaseService.messages.findOne(
      { sender_id: senderObjectId, client_message_id: clientMessageId },
      { session }
    )
  }

  private async loadExistingResult(
    message: Message,
    command: ReturnType<ConversationMessageCommandService['normalizeSendCommand']>,
    session?: ClientSession
  ): Promise<MessageCommandResult> {
    this.assertMessageIdentity(message, command)
    const medias = message.media_ids.length
      ? await this.databaseService.medias.find({ _id: { $in: message.media_ids } }, { session }).toArray()
      : []
    return { created: false, message, medias_info: medias, member_ids: [], read_mutations: [] }
  }

  private async loadExistingForwardResults(
    command: ForwardMessageCommand,
    conversationIds: string[],
    operationId: string
  ): Promise<MessageCommandResult[]> {
    const senderId = new this.databaseService.ObjectId(command.sender_id)
    const originId = new this.databaseService.ObjectId(command.origin_message_id)
    const results: MessageCommandResult[] = []
    for (const conversationId of conversationIds) {
      const clientMessageId = `${operationId}:${conversationId}`
      const existing = await this.findByClientMessageId(senderId, clientMessageId)
      if (!existing) throw new Error('Concurrent forward retry did not persist every target')
      const normalized = this.normalizeSendCommand({
        sender_id: command.sender_id,
        conversation_id: conversationId,
        conversation_type: await this.resolveConversationType(senderId, conversationId),
        content: existing.content,
        media_ids: existing.media_ids.map((id) => id.toHexString()),
        client_message_id: clientMessageId
      })
      this.assertMessageIdentity(existing, normalized, originId)
      results.push(await this.loadExistingResult(existing, normalized))
    }
    return results
  }

  private assertMessageIdentity(
    message: Message,
    command: ReturnType<ConversationMessageCommandService['normalizeSendCommand']>,
    originMessageId?: ObjectId
  ): void {
    const expectedPayloadHash = this.createClientPayloadHash(command, originMessageId)
    if (message.client_payload_hash !== undefined) {
      if (message.client_payload_hash !== expectedPayloadHash) {
        throw new HttpError(
          'client_message_id was already used for a different message',
          HTTP_STATUS.CONFLICT,
          undefined,
          CLIENT_MESSAGE_ID_CONFLICT_CODE
        )
      }
      return
    }

    const mediaIds = message.media_ids.map((id) => id.toHexString())
    const expectedMediaIds = command.media_ids ?? []
    const sameReply = (message.reply_to_message_id?.toHexString() ?? null) === (command.reply_to_message_id ?? null)
    const sameOrigin = originMessageId === undefined || message.origin_message_id?.equals(originMessageId) === true
    if (
      message.conversation_id.toHexString() !== command.conversation_id ||
      message.conversation_type !== command.conversation_type ||
      message.content !== (command.content ?? '') ||
      mediaIds.length !== expectedMediaIds.length ||
      mediaIds.some((id, index) => id !== expectedMediaIds[index]) ||
      !sameReply ||
      !sameOrigin
    ) {
      throw new HttpError(
        'client_message_id was already used for a different message',
        HTTP_STATUS.CONFLICT,
        undefined,
        CLIENT_MESSAGE_ID_CONFLICT_CODE
      )
    }
  }

  private createClientPayloadHash(
    command: ReturnType<ConversationMessageCommandService['normalizeSendCommand']>,
    originMessageId?: ObjectId
  ): string {
    const canonicalObjectId = (id: string) => new this.databaseService.ObjectId(id).toHexString()
    const identity = {
      conversation_id: canonicalObjectId(command.conversation_id),
      conversation_type: command.conversation_type,
      content: command.content ?? '',
      media_ids: (command.media_ids ?? []).map(canonicalObjectId),
      reply_to_message_id: command.reply_to_message_id ? canonicalObjectId(command.reply_to_message_id) : null,
      mention_user_ids: [...(command.mention_user_ids ?? [])].sort(),
      origin_message_id: originMessageId?.toHexString() ?? null
    }
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  }
}

const conversationMessageCommandService = new ConversationMessageCommandService()
export default conversationMessageCommandService
