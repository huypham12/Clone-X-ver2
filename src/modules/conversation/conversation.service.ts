import DatabaseService from '~/config/database.service'
import { ClientSession, Document, Filter, ObjectId } from 'mongodb'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import redisService from '~/config/redis.service'
import { getIO } from '~/socket'
import { MediaStatus, MediaType } from '~/constants/enums'
import type User from '~/schemas/User.schema'
import conversationAccessService, {
  getConversationHistoryCutoff,
  type ConversationType
} from './conversation-access.service'
import conversationMessageAccessService from './conversation-message-access.service'
import conversationMessageHydrationService from './conversation-message-hydration.service'
import conversationMessageSyncService from './conversation-message-sync.service'
import {
  isMessageReactionEmoji,
  type ConversationHistoryClearedEvent,
  type MessageContextData,
  type MessageDeletedForMeEvent,
  type MessageReactionEmoji,
  type MessageReactionState,
  type MessageReactionUpdatedEvent,
  type MessageRevokedEvent,
  type MessageWithMediaInfo
} from './dto'

type ConversationPartner = Pick<User, '_id' | 'name' | 'username' | 'avatar'>
type DirectConversationAggregate = DirectConversation & {
  partner_id: ObjectId
  partnerInfo?: ConversationPartner
}

type GroupUpdateType = 'info_updated' | 'members_added' | 'member_removed' | 'member_left' | 'admin_transferred'

const GROUP_ADMIN_CANNOT_REMOVE_SELF_CODE = 'GROUP_ADMIN_CANNOT_REMOVE_SELF'
const GROUP_SOLE_ADMIN_CANNOT_LEAVE_CODE = 'GROUP_SOLE_ADMIN_CANNOT_LEAVE'
const GROUP_ADMIN_SUCCESSOR_INVALID_CODE = 'GROUP_ADMIN_SUCCESSOR_INVALID'
const GROUP_ADMIN_TRANSFER_CONFLICT_CODE = 'GROUP_ADMIN_TRANSFER_CONFLICT'

interface GroupUpdateEvent {
  conversation_id: string
  change_type: GroupUpdateType
  actor_id: string
  affected_user_ids: string[]
}

const MESSAGE_QUERY_MAX_TIME_MS = 10000
const escapeRegularExpression = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
type MessageIdRange = { $lt?: ObjectId; $gt?: ObjectId }
const createMessageIdRange = (cursor?: string, cutoff?: ObjectId): MessageIdRange | undefined => {
  const range: MessageIdRange = {}
  if (cursor) range.$lt = new ObjectId(cursor)
  if (cutoff) range.$gt = cutoff
  return Object.keys(range).length > 0 ? range : undefined
}
const isMessageAfterCutoff = (messageId: unknown, cutoff?: ObjectId) => {
  if (!cutoff) return true
  if (typeof messageId === 'string') return messageId > cutoff.toString()
  return messageId instanceof ObjectId && messageId.toString() > cutoff.toString()
}
const createUnhideConversationPipeline = (userId: ObjectId, reopenedAt: Date): Document[] => {
  const hasPendingHistoryRestore = {
    $gt: [
      {
        $size: {
          $filter: {
            input: { $ifNull: ['$history_cleared_by', []] },
            as: 'marker',
            cond: {
              $and: [
                { $eq: ['$$marker.user_id', userId] },
                { $eq: ['$$marker.restore_on_next_message', true] }
              ]
            }
          }
        }
      },
      0
    ]
  }

  return [{
    $set: {
      hidden_by: {
        $filter: {
          input: { $ifNull: ['$hidden_by', []] },
          as: 'hiddenUserId',
          cond: { $ne: ['$$hiddenUserId', userId] }
        }
      },
      history_cleared_by: {
        $map: {
          input: { $ifNull: ['$history_cleared_by', []] },
          as: 'marker',
          in: {
            $cond: [
              { $eq: ['$$marker.user_id', userId] },
              { $mergeObjects: ['$$marker', { restore_on_next_message: false }] },
              '$$marker'
            ]
          }
        }
      },
      muted_by: {
        $cond: [
          hasPendingHistoryRestore,
          {
            $filter: {
              input: { $ifNull: ['$muted_by', []] },
              as: 'mute',
              cond: { $ne: ['$$mute.user_id', userId] }
            }
          },
          { $ifNull: ['$muted_by', []] }
        ]
      },
      updated_at: reopenedAt
    }
  }]
}
const isMessageVisibleToUser = (message: MessageWithMediaInfo, userId: string) =>
  message.status !== 'deleted' &&
  !message.deleted_by?.some((deletedByUserId) => deletedByUserId.toString() === userId)
const createMessageReactionState = (reactions: Message['reactions']): MessageReactionState => {
  const publicReactions = reactions.flatMap((reaction) =>
    isMessageReactionEmoji(reaction.emoji)
      ? [{ emoji: reaction.emoji, user_id: reaction.user_id.toString() }]
      : []
  )
  const counts = new Map<MessageReactionEmoji, number>()

  publicReactions.forEach((reaction) => {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
  })

  return {
    reactions: publicReactions,
    summary: [...counts].map(([emoji, count]) => ({ emoji, count }))
  }
}

class ConversationService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  private formatDirectConversation(
    conversationDocument: DirectConversationAggregate,
    actorId: ObjectId
  ) {
    const {
      partnerInfo,
      last_message_overrides,
      history_cleared_by: _historyClearedBy,
      ...conversation
    } = conversationDocument
    const actorOverride = last_message_overrides?.find((override) =>
      override.user_id.equals(actorId)
    )

    return {
      ...conversation,
      type: 'direct' as const,
      last_message_at: actorOverride?.last_message_at ?? conversation.last_message_at,
      last_message_preview: actorOverride?.last_message_preview ?? conversation.last_message_preview,
      partner_info: partnerInfo
        ? {
            _id: partnerInfo._id,
            name: partnerInfo.name,
            username: partnerInfo.username,
            avatar: partnerInfo.avatar
          }
        : null,
      is_pinned: conversation.pinned_by?.some((id) => id.equals(actorId)) || false
    }
  }

  private formatGroupConversation(conversationDocument: GroupConversation, actorId: ObjectId) {
    const {
      last_message_overrides,
      history_cleared_by: _historyClearedBy,
      ...conversation
    } = conversationDocument
    const actorOverride = last_message_overrides?.find((override) =>
      override.user_id.equals(actorId)
    )

    return {
      ...conversation,
      type: 'group' as const,
      last_message_at: actorOverride?.last_message_at ?? conversation.last_message_at,
      last_message_preview: actorOverride?.last_message_preview ?? conversation.last_message_preview,
      is_pinned: conversation.pinned_by?.some((id) => id.equals(actorId)) || false
    }
  }

  private async getDirectConversationSummary(actorId: ObjectId, conversationId: ObjectId) {
    const conversation = await this.databaseService.directConversations
      .aggregate<DirectConversationAggregate>([
        {
          $match: {
            _id: conversationId,
            $or: [{ user1_id: actorId }, { user2_id: actorId }],
            hidden_by: { $ne: actorId }
          }
        },
        {
          $addFields: {
            partner_id: {
              $cond: {
                if: { $eq: ['$user1_id', actorId] },
                then: '$user2_id',
                else: '$user1_id'
              }
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'partner_id',
            foreignField: '_id',
            as: 'partnerInfo'
          }
        },
        { $unwind: { path: '$partnerInfo', preserveNullAndEmptyArrays: true } },
        { $limit: 1 }
      ])
      .next()

    if (!conversation) {
      throw new HttpError('Conversation could not be restored', HTTP_STATUS.CONFLICT)
    }

    return this.formatDirectConversation(conversation, actorId)
  }

  private async getGroupConversationSummary(actorId: ObjectId, conversationId: ObjectId) {
    const conversation = await this.databaseService.groupConversations.findOne({
      _id: conversationId,
      'members.user_id': actorId,
      hidden_by: { $ne: actorId }
    })

    if (!conversation) {
      throw new HttpError('Conversation could not be restored', HTTP_STATUS.CONFLICT)
    }

    return this.formatGroupConversation(conversation, actorId)
  }

  private async invalidateGroupMemberCache(conversationId: string) {
    try {
      await redisService.del(`conv_members:${conversationId}`)
    } catch (error) {
      console.error('Could not invalidate group member cache:', error)
    }
  }

  private emitGroupUpdate(recipientIds: string[], event: GroupUpdateEvent) {
    const uniqueRecipientIds = [...new Set(recipientIds)]
    if (uniqueRecipientIds.length === 0) return

    try {
      getIO().to(uniqueRecipientIds).emit('@conversation:group-updated', event)
    } catch (error) {
      console.error('Could not emit group update:', error)
    }
  }

  private async syncGroupMembership(recipientIds: string[], event: GroupUpdateEvent) {
    await this.invalidateGroupMemberCache(event.conversation_id)
    let currentMemberIds: string[] = []

    try {
      const group = await this.databaseService.groupConversations.findOne(
        { _id: new this.databaseService.ObjectId(event.conversation_id) },
        { projection: { members: 1 } }
      )
      currentMemberIds = group?.members.map((member) => member.user_id.toString()) ?? []
    } catch (error) {
      console.error('Could not refresh group members before emitting update:', error)
    }

    this.emitGroupUpdate([...recipientIds, ...currentMemberIds], event)
  }

  private async buildLastMessagePreview(message: Message, session?: ClientSession) {
    if (message.status === 'revoked') {
      return {
        message_id: message._id,
        sender_id: message.sender_id,
        content: 'Message was revoked',
        message_type: 'text' as const
      }
    }

    const firstMedia = message.media_ids[0]
      ? await this.databaseService.medias.findOne(
          { _id: message.media_ids[0] },
          { projection: { type: 1 }, session }
        )
      : null
    const messageType =
      firstMedia?.type === MediaType.Image ||
      firstMedia?.type === MediaType.Video ||
      firstMedia?.type === MediaType.Audio
        ? firstMedia.type
        : firstMedia
          ? ('file' as const)
          : ('text' as const)

    return {
      message_id: message._id,
      sender_id: message.sender_id,
      content: message.content.substring(0, 50),
      message_type: messageType
    }
  }

  private async setLastMessageOverride(
    userId: string,
    deletedMessage: Message,
    session?: ClientSession,
    historyCutoffMessageId?: ObjectId
  ): Promise<boolean> {
    if (!deletedMessage._id || !deletedMessage.send_at) return false

    const actorId = new this.databaseService.ObjectId(userId)
    const latestVisibleMessage = await this.databaseService.messages
      .find({
        conversation_id: deletedMessage.conversation_id,
        status: { $in: ['sent', 'revoked'] },
        deleted_by: { $ne: actorId },
        ...(historyCutoffMessageId ? { _id: { $gt: historyCutoffMessageId } } : {})
      }, { session })
      .sort({ _id: -1 })
      .limit(1)
      .next()
    const lastMessagePreview = latestVisibleMessage
      ? await this.buildLastMessagePreview(latestVisibleMessage, session)
      : {
          sender_id: actorId,
          content: 'No visible messages',
          message_type: 'text' as const
        }
    const override = {
      user_id: actorId,
      message_id: latestVisibleMessage?._id,
      last_message_at:
        latestVisibleMessage?.send_at ?? deletedMessage.conversation_id.getTimestamp(),
      last_message_preview: lastMessagePreview
    }
    const updatePipeline: Document[] = [
      {
        $set: {
          last_message_overrides: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$last_message_overrides', []] },
                  as: 'override',
                  cond: { $ne: ['$$override.user_id', actorId] }
                }
              },
              [override]
            ]
          },
          updated_at: new Date()
        }
      }
    ]

    if (deletedMessage.conversation_type === 'direct') {
      const result = await this.databaseService.directConversations.updateOne(
        { _id: deletedMessage.conversation_id },
        updatePipeline,
        { session }
      )
      return result.matchedCount === 1
    }

    const result = await this.databaseService.groupConversations.updateOne(
      { _id: deletedMessage.conversation_id },
      updatePipeline,
      { session }
    )
    return result.matchedCount === 1
  }

  private async syncLastMessagePreviewAfterRevoke(message: Message): Promise<void> {
    if (!message._id || !message.send_at) return

    const conversation =
      message.conversation_type === 'direct'
        ? await this.databaseService.directConversations.findOne(
            { _id: message.conversation_id },
            { projection: { last_message_at: 1, last_message_overrides: 1, history_cleared_by: 1 } }
          )
        : await this.databaseService.groupConversations.findOne(
            { _id: message.conversation_id },
            { projection: { last_message_at: 1, last_message_overrides: 1, history_cleared_by: 1 } }
          )
    if (!conversation?.last_message_at) return

    const latestSentMessage = await this.databaseService.messages
      .find({ conversation_id: message.conversation_id, status: 'sent' })
      .sort({ _id: -1 })
      .limit(1)
      .next()
    const affectedOverrideUserIds = (conversation.last_message_overrides ?? [])
      .filter(
        (override) =>
          override.message_id?.equals(message._id) ||
          override.last_message_preview.message_id?.equals(message._id)
      )
      .map((override) => override.user_id.toString())

    if (!latestSentMessage || latestSentMessage._id.toString() <= message._id.toString()) {
      const lastMessagePreview = latestSentMessage
        ? await this.buildLastMessagePreview(latestSentMessage)
        : {
            message_id: message._id,
            sender_id: message.sender_id,
            content: 'Message was revoked',
            message_type: 'text' as const
          }
      const update = {
        $set: {
          last_message_at: latestSentMessage?.send_at ?? message.send_at,
          last_message_preview: lastMessagePreview,
          updated_at: new Date()
        }
      }
      const filter = {
        _id: message.conversation_id,
        last_message_at: conversation.last_message_at
      }

      if (message.conversation_type === 'direct') {
        await this.databaseService.directConversations.updateOne(filter, update)
      } else {
        await this.databaseService.groupConversations.updateOne(filter, update)
      }
    }

    await Promise.all(
      affectedOverrideUserIds.map((overrideUserId) =>
        this.setLastMessageOverride(
          overrideUserId,
          message,
          undefined,
          getConversationHistoryCutoff(conversation, overrideUserId)
        )
      )
    )
  }

  async getConversations(userId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)

    const [directs, groups] = await Promise.all([
      this.databaseService.directConversations
        .aggregate<DirectConversationAggregate>([
          {
            $match: {
              $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }],
              hidden_by: { $ne: objectIdUserId }
            }
          },
          {
            $addFields: {
              partner_id: {
                $cond: {
                  if: { $eq: ['$user1_id', objectIdUserId] },
                  then: '$user2_id',
                  else: '$user1_id'
                }
              }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'partner_id',
              foreignField: '_id',
              as: 'partnerInfo'
            }
          },
          { $unwind: { path: '$partnerInfo', preserveNullAndEmptyArrays: true } }
        ])
        .toArray(),

      this.databaseService.groupConversations
        .find({
          'members.user_id': objectIdUserId,
          hidden_by: { $ne: objectIdUserId }
        })
        .toArray()
    ])

    const formattedDirects = directs.map((conversation) =>
      this.formatDirectConversation(conversation, objectIdUserId)
    )
    const formattedGroups = groups.map((conversation) =>
      this.formatGroupConversation(conversation, objectIdUserId)
    )

    const merged = [...formattedDirects, ...formattedGroups].sort((a, b) => {
      // 1. Sort by pinned status first
      if (a.is_pinned && !b.is_pinned) return -1
      if (!a.is_pinned && b.is_pinned) return 1

      // 2. Then sort by last_message_at
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return timeB - timeA
    })

    return merged
  }

  async getOrCreateDirectConversation(user1_id: string, user2_id: string) {
    if (user1_id === user2_id) {
      throw new HttpError('Cannot chat with yourself', HTTP_STATUS.BAD_REQUEST)
    }

    const id1 = new this.databaseService.ObjectId(user1_id)
    const id2 = new this.databaseService.ObjectId(user2_id)

    await conversationAccessService.assertDirectMessagingAllowed(user1_id, user2_id)

    // Ensure user1_id < user2_id to maintain consistency
    const [u1, u2] = user1_id < user2_id ? [id1, id2] : [id2, id1]

    const conversation = await this.databaseService.directConversations.findOne({
      user1_id: u1,
      user2_id: u2
    })

    let conversationId: ObjectId
    let reopenedAt: Date

    if (!conversation) {
      const newConversation = new DirectConversation({
        _id: new this.databaseService.ObjectId(),
        user1_id: u1,
        user2_id: u2,
        last_message_at: new Date(),
        last_message_preview: { sender_id: id1, content: 'Conversation started', message_type: 'text' }
      })
      await this.databaseService.directConversations.insertOne(newConversation)
      conversationId = newConversation._id as ObjectId
      reopenedAt = newConversation.updated_at as Date
    } else {
      conversationId = conversation._id
      reopenedAt = new Date()
      const result = await this.databaseService.directConversations.updateOne(
        { _id: conversationId, $or: [{ user1_id: id1 }, { user2_id: id1 }] },
        createUnhideConversationPipeline(id1, reopenedAt)
      )

      if (result.matchedCount !== 1) {
        throw new HttpError('Conversation could not be opened', HTTP_STATUS.CONFLICT)
      }
    }

    return {
      success: true as const,
      reopened_at: reopenedAt,
      conversation: await this.getDirectConversationSummary(id1, conversationId)
    }
  }

  async searchGroupConversations(userId: string, keyword: string, cursor: string | undefined, limit: number) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const filter: Filter<GroupConversation> = {
      'members.user_id': objectIdUserId,
      name: new RegExp(escapeRegularExpression(keyword.trim()), 'i')
    }

    if (cursor) {
      filter._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const results = await this.databaseService.groupConversations
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .toArray()
    const hasNextPage = results.length > limit
    const page = hasNextPage ? results.slice(0, limit) : results

    return {
      groups: page.map((group) => ({
        _id: group._id.toString(),
        name: group.name,
        avatar_url: group.avatar_url,
        member_count: group.members.length,
        is_hidden: group.hidden_by?.some((id) => id.equals(objectIdUserId)) ?? false
      })),
      next_cursor: hasNextPage ? (page.at(-1)?._id.toString() ?? null) : null,
      has_next_page: hasNextPage
    }
  }

  async unhideConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)

    const reopenedAt = new Date()
    const result =
      access.type === 'direct'
        ? await this.databaseService.directConversations.updateOne(
            {
              _id: conversationObjectId,
              $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }]
            },
            createUnhideConversationPipeline(objectIdUserId, reopenedAt)
          )
        : await this.databaseService.groupConversations.updateOne(
            {
              _id: conversationObjectId,
              'members.user_id': objectIdUserId
            },
            createUnhideConversationPipeline(objectIdUserId, reopenedAt)
          )

    if (result.matchedCount === 0) {
      throw new HttpError('You are no longer a member of this conversation', HTTP_STATUS.FORBIDDEN)
    }

    const conversation =
      access.type === 'direct'
        ? await this.getDirectConversationSummary(objectIdUserId, conversationObjectId)
        : await this.getGroupConversationSummary(objectIdUserId, conversationObjectId)

    return { success: true as const, reopened_at: reopenedAt, conversation }
  }

  async createGroupConversation(userId: string, name: string, membersIds: string[], avatar_url?: string) {
    const creatorId = new this.databaseService.ObjectId(userId)
    const members = [creatorId, ...membersIds.map((id) => new this.databaseService.ObjectId(id))]

    // Remove duplicates
    const uniqueMembers = Array.from(new Set(members.map((id) => id.toString()))).map(
      (id) => new this.databaseService.ObjectId(id)
    )

    if (uniqueMembers.length < 3) {
      throw new HttpError('Group must have at least 3 members', HTTP_STATUS.BAD_REQUEST)
    }

    const existingMembersCount = await this.databaseService.users.countDocuments({
      _id: { $in: uniqueMembers }
    })
    if (existingMembersCount !== uniqueMembers.length) {
      throw new HttpError('One or more group members do not exist', HTTP_STATUS.BAD_REQUEST)
    }

    const newGroup = new GroupConversation({
      _id: new this.databaseService.ObjectId(),
      name,
      avatar_url,
      created_by: creatorId,
      admin_only_messaging: false,
      members: uniqueMembers.map((id) => ({
        user_id: id,
        role: id.equals(creatorId) ? 'admin' : 'member',
        joined_at: new Date()
      })),
      last_message_at: new Date(),
      last_message_preview: { sender_id: creatorId, content: 'Group created', message_type: 'text' },
      created_at: new Date(),
      updated_at: new Date()
    })

    await this.databaseService.groupConversations.insertOne(newGroup)
    return newGroup
  }

  async deleteConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }] },
        { $addToSet: { hidden_by: objectIdUserId } }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': objectIdUserId },
        { $addToSet: { hidden_by: objectIdUserId } }
      )
    }

    return { success: true }
  }

  async clearConversationHistory(userId: string, conversationId: string) {
    const actorId = new this.databaseService.ObjectId(userId)
    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const latestMessage = await this.databaseService.messages
      .find(
        { conversation_id: conversationObjectId },
        { projection: { _id: 1 } }
      )
      .sort({ _id: -1 })
      .limit(1)
      .next()
    const clearedAt = new Date()
    const historyMarker = {
      user_id: actorId,
      cleared_at: clearedAt,
      cleared_through_message_id: latestMessage?._id ?? null,
      restore_on_next_message: true
    }
    const emptyPreviewOverride = {
      user_id: actorId,
      last_message_at: clearedAt,
      last_message_preview: {
        sender_id: actorId,
        content: 'No visible messages',
        message_type: 'text' as const
      }
    }
    const updatePipeline: Document[] = [
      {
        $set: {
          history_cleared_by: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$history_cleared_by', []] },
                  as: 'marker',
                  cond: { $ne: ['$$marker.user_id', actorId] }
                }
              },
              [historyMarker]
            ]
          },
          hidden_by: {
            $setUnion: [{ $ifNull: ['$hidden_by', []] }, [actorId]]
          },
          pinned_by: {
            $filter: {
              input: { $ifNull: ['$pinned_by', []] },
              as: 'pinnedUserId',
              cond: { $ne: ['$$pinnedUserId', actorId] }
            }
          },
          muted_by: {
            $filter: {
              input: { $ifNull: ['$muted_by', []] },
              as: 'mute',
              cond: { $ne: ['$$mute.user_id', actorId] }
            }
          },
          last_message_overrides: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$last_message_overrides', []] },
                  as: 'override',
                  cond: { $ne: ['$$override.user_id', actorId] }
                }
              },
              [emptyPreviewOverride]
            ]
          },
          updated_at: clearedAt
        }
      }
    ]
    const updateResult =
      access.type === 'direct'
        ? await this.databaseService.directConversations.updateOne(
            {
              _id: conversationObjectId,
              $or: [{ user1_id: actorId }, { user2_id: actorId }]
            },
            updatePipeline
          )
        : await this.databaseService.groupConversations.updateOne(
            { _id: conversationObjectId, 'members.user_id': actorId },
            updatePipeline
          )

    if (updateResult.matchedCount !== 1) {
      throw new HttpError('Conversation history could not be cleared', HTTP_STATUS.CONFLICT)
    }

    const historyClearedEvent: ConversationHistoryClearedEvent = {
      conversation_id: conversationId,
      cleared_at: clearedAt.toISOString()
    }
    await conversationMessageSyncService.syncActorAction(
      conversationId,
      userId,
      '@conversation:history-cleared',
      historyClearedEvent
    )

    return { success: true as const, cleared_at: clearedAt }
  }

  async getMessages(userId: string, conversationId: string, cursor: string | undefined, limit: number) {
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const historyCutoffMessageId = getConversationHistoryCutoff(access.conversation, userId)

    const redisKey = `chat:messages:${conversationId}`
    const convId = new this.databaseService.ObjectId(conversationId)

    let rawMessages: MessageWithMediaInfo[] = []

    if (!cursor) {
      const cachedMessages = await redisService.clientInstance.zRange(redisKey, 0, limit, { REV: true })
      if (cachedMessages && cachedMessages.length > limit) {
        const visibleCachedMessages = cachedMessages
          .map((msg: string) => JSON.parse(msg) as MessageWithMediaInfo)
          .filter(
            (message) =>
              isMessageVisibleToUser(message, userId) &&
              isMessageAfterCutoff(message._id, historyCutoffMessageId)
          )
        if (visibleCachedMessages.length > limit) {
          rawMessages = visibleCachedMessages
        }
      }
    }

    if (rawMessages.length < limit) {
      const matchStage: Filter<Message> = {
        conversation_id: convId,
        status: { $in: ['sent', 'revoked'] },
        deleted_by: { $ne: new this.databaseService.ObjectId(userId) }
      }
      const messageIdRange = createMessageIdRange(cursor, historyCutoffMessageId)
      if (messageIdRange) matchStage._id = messageIdRange

      rawMessages = await this.databaseService.messages
        .aggregate<MessageWithMediaInfo>([
          { $match: matchStage },
          { $sort: { _id: -1 } },
          { $limit: limit + 1 },
          {
            $lookup: {
              from: 'medias',
              localField: 'media_ids',
              foreignField: '_id',
              as: 'medias_info'
            }
          }
        ])
        .toArray()
    }

    const messages = await conversationMessageHydrationService.hydrateSenderInfo(
      rawMessages.slice(0, limit),
      userId,
      historyCutoffMessageId
    )

    const has_next_page = rawMessages.length > limit
    const next_cursor = has_next_page ? (messages[messages.length - 1]?._id?.toString() ?? null) : null

    return { messages, next_cursor, has_next_page }
  }

  async getMessageContext(
    userId: string,
    conversationId: string,
    messageId: string,
    before: number,
    after: number
  ): Promise<MessageContextData> {
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const historyCutoffMessageId = getConversationHistoryCutoff(access.conversation, userId)

    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const messageObjectId = new this.databaseService.ObjectId(messageId)
    if (!isMessageAfterCutoff(messageObjectId, historyCutoffMessageId)) {
      throw new HttpError('Message not found in this conversation', HTTP_STATUS.NOT_FOUND)
    }
    const target = await this.databaseService.messages.findOne({
      _id: messageObjectId,
      conversation_id: conversationObjectId,
      status: 'sent',
      deleted_by: { $ne: new this.databaseService.ObjectId(userId) }
    })

    if (!target) {
      throw new HttpError('Message not found in this conversation', HTTP_STATUS.NOT_FOUND)
    }

    const aggregateMessages = (
      match: Filter<Message>,
      sortDirection: 1 | -1,
      limit: number
    ): Promise<MessageWithMediaInfo[]> => {
      if (limit === 0) return Promise.resolve([])

      return this.databaseService.messages
        .aggregate<MessageWithMediaInfo>(
          [
            { $match: match },
            { $sort: { _id: sortDirection } },
            { $limit: limit },
            {
              $lookup: {
                from: 'medias',
                localField: 'media_ids',
                foreignField: '_id',
                as: 'medias_info'
              }
            }
          ],
          { maxTimeMS: MESSAGE_QUERY_MAX_TIME_MS }
        )
        .toArray()
    }

    const baseMatch: Filter<Message> = {
      conversation_id: conversationObjectId,
      status: 'sent',
      deleted_by: { $ne: new this.databaseService.ObjectId(userId) }
    }
    const olderMessageRange: MessageIdRange = { $lt: messageObjectId }
    if (historyCutoffMessageId) olderMessageRange.$gt = historyCutoffMessageId

    const [olderDescending, targetMessages, newerAscending] = await Promise.all([
      aggregateMessages({ ...baseMatch, _id: olderMessageRange }, -1, before + 1),
      aggregateMessages({ ...baseMatch, _id: messageObjectId }, 1, 1),
      aggregateMessages({ ...baseMatch, _id: { $gt: messageObjectId } }, 1, after + 1)
    ])

    if (targetMessages.length !== 1) {
      throw new HttpError('Message not found in this conversation', HTTP_STATUS.NOT_FOUND)
    }

    const hasOlderMessages = olderDescending.length > before
    const hasNewerMessages = newerAscending.length > after
    const olderMessages = olderDescending.slice(0, before).reverse()
    const newerMessages = newerAscending.slice(0, after)
    const oldestIncludedMessage = olderMessages[0]
    const newestIncludedMessage = newerMessages[newerMessages.length - 1]

    const messages = await conversationMessageHydrationService.hydrateSenderInfo(
      [...olderMessages, ...targetMessages, ...newerMessages],
      userId,
      historyCutoffMessageId
    )

    return {
      messages,
      target_message_id: messageId,
      older_cursor: hasOlderMessages ? (oldestIncludedMessage?._id?.toString() ?? null) : null,
      newer_cursor: hasNewerMessages ? (newestIncludedMessage?._id?.toString() ?? null) : null
    }
  }

  async markAsRead(userId: string, conversationId: string) {
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const historyCutoffMessageId = getConversationHistoryCutoff(access.conversation, userId)

    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)

    await this.databaseService.messages.updateMany(
      {
        conversation_id: convId,
        read_by: { $ne: objectIdUserId },
        ...(historyCutoffMessageId ? { _id: { $gt: historyCutoffMessageId } } : {})
      },
      { $addToSet: { read_by: objectIdUserId } }
    )

    return { success: true }
  }

  async revokeMessage(userId: string, messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)
    const { message, conversation } = await conversationMessageAccessService.assertMessageAccess(
      userId,
      messageId,
      { requireSender: true, allowedStatuses: ['sent'] }
    )
    const updateResult = await this.databaseService.messages.updateOne(
      { _id: msgId, sender_id: new this.databaseService.ObjectId(userId), status: 'sent' },
      {
        $set: {
          status: 'revoked',
          content: '',
          media_ids: [],
          reactions: []
        },
        $unset: { reply_to_message_id: '' }
      }
    )
    if (updateResult.modifiedCount !== 1) {
      throw new HttpError('Message state changed before it could be revoked', HTTP_STATUS.CONFLICT)
    }

    const conversationId = message.conversation_id.toString()
    await this.syncLastMessagePreviewAfterRevoke(message)
    const revokedEvent: MessageRevokedEvent = {
      conversation_id: conversationId,
      message_id: messageId
    }
    await conversationMessageSyncService.syncConversationAction(
      conversationId,
      conversation.memberIds,
      '@message:revoked',
      revokedEvent
    )

    return { success: true }
  }

  async deleteMessage(userId: string, messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)
    const { message, conversation } = await conversationMessageAccessService.assertMessageAccess(
      userId,
      messageId,
      {
        requireVisibleToUser: true,
        allowedStatuses: ['sent']
      }
    )
    const actorId = new this.databaseService.ObjectId(userId)
    const session = this.databaseService.startSession()

    try {
      await session.withTransaction(async () => {
        const updateResult = await this.databaseService.messages.updateOne(
          { _id: msgId, status: 'sent', deleted_by: { $ne: actorId } },
          { $addToSet: { deleted_by: actorId } },
          { session }
        )
        if (updateResult.modifiedCount !== 1) {
          throw new HttpError('Message state changed before it could be deleted', HTTP_STATUS.CONFLICT)
        }

        const previewUpdated = await this.setLastMessageOverride(
          userId,
          message,
          session,
          getConversationHistoryCutoff(conversation.conversation, userId)
        )
        if (!previewUpdated) {
          throw new HttpError('Conversation preview could not be updated', HTTP_STATUS.CONFLICT)
        }
      })
    } finally {
      await session.endSession()
    }

    const conversationId = message.conversation_id.toString()
    const deletedEvent: MessageDeletedForMeEvent = {
      conversation_id: conversationId,
      message_id: messageId
    }
    await conversationMessageSyncService.syncActorAction(
      conversationId,
      userId,
      '@message:deleted-for-me',
      deletedEvent
    )

    return { success: true }
  }

  async reactMessage(userId: string, messageId: string, emoji: MessageReactionEmoji) {
    if (!isMessageReactionEmoji(emoji)) {
      throw new HttpError('Unsupported reaction emoji', HTTP_STATUS.BAD_REQUEST)
    }

    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const { message, conversation } = await conversationMessageAccessService.assertMessageAccess(
      userId,
      messageId,
      { requireVisibleToUser: true, allowedStatuses: ['sent'] }
    )
    const reactionUpdatePipeline: Document[] = [
      {
        $set: {
          reactions: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$reactions', []] },
                  as: 'reaction',
                  cond: { $ne: ['$$reaction.user_id', objectIdUserId] }
                }
              },
              [{ emoji, user_id: objectIdUserId }]
            ]
          }
        }
      }
    ]
    const updatedMessage = await this.databaseService.messages.findOneAndUpdate(
      {
        _id: msgId,
        status: 'sent',
        deleted_by: { $ne: objectIdUserId }
      },
      reactionUpdatePipeline,
      { returnDocument: 'after', projection: { reactions: 1 } }
    )
    if (!updatedMessage) {
      throw new HttpError('Message state changed before it could be reacted to', HTTP_STATUS.CONFLICT)
    }

    const conversationId = message.conversation_id.toString()
    const reactionState = createMessageReactionState(updatedMessage.reactions)
    const reactionEvent: MessageReactionUpdatedEvent = {
      conversation_id: conversationId,
      message_id: messageId,
      ...reactionState
    }
    await conversationMessageSyncService.syncConversationAction(
      conversationId,
      conversation.memberIds,
      '@message:reaction-updated',
      reactionEvent
    )

    return reactionState
  }

  async pinConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)

    // Check total pinned count
    const [pinnedDirectsCount, pinnedGroupsCount] = await Promise.all([
      this.databaseService.directConversations.countDocuments({ pinned_by: objectIdUserId }),
      this.databaseService.groupConversations.countDocuments({ pinned_by: objectIdUserId })
    ])

    if (pinnedDirectsCount + pinnedGroupsCount >= 5) {
      throw new HttpError('Maximum 5 pinned conversations allowed', HTTP_STATUS.BAD_REQUEST)
    }

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }] },
        { $addToSet: { pinned_by: objectIdUserId } }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': objectIdUserId },
        { $addToSet: { pinned_by: objectIdUserId } }
      )
    }

    return { success: true }
  }

  async unpinConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }] },
        { $pull: { pinned_by: objectIdUserId } } as any
      )
    } else {
      await this.databaseService.groupConversations.updateOne({ _id: convId, 'members.user_id': objectIdUserId }, {
        $pull: { pinned_by: objectIdUserId }
      } as any)
    }

    return { success: true }
  }

  async searchMessages(userId: string, conversationId: string, q: string, cursor: string | undefined, limit: number) {
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const historyCutoffMessageId = getConversationHistoryCutoff(access.conversation, userId)

    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: Filter<Message> = {
      conversation_id: convId,
      status: 'sent',
      deleted_by: { $ne: new this.databaseService.ObjectId(userId) },
      $text: { $search: q }
    }
    const messageIdRange = createMessageIdRange(cursor, historyCutoffMessageId)
    if (messageIdRange) matchStage._id = messageIdRange

    const matchedMessages: MessageWithMediaInfo[] = await this.databaseService.messages
      .find(matchStage, { maxTimeMS: MESSAGE_QUERY_MAX_TIME_MS })
      .sort({ _id: -1 }) // Search cursor relies on _id sort instead of text score
      .limit(limit + 1)
      .toArray()

    const has_next_page = matchedMessages.length > limit
    const messages = await conversationMessageHydrationService.hydrateSenderInfo(
      matchedMessages.slice(0, limit),
      userId,
      historyCutoffMessageId
    )
    const next_cursor = has_next_page ? (messages[messages.length - 1]?._id?.toString() ?? null) : null

    return { messages, next_cursor, has_next_page }
  }

  async getConversationMedia(userId: string, conversationId: string, cursor: string | undefined, limit: number) {
    const access = await conversationAccessService.assertConversationMember(userId, conversationId)
    const historyCutoffMessageId = getConversationHistoryCutoff(access.conversation, userId)

    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: Filter<Message> = {
      conversation_id: convId,
      status: 'sent',
      deleted_by: { $ne: new this.databaseService.ObjectId(userId) },
      media_ids: { $exists: true, $not: { $size: 0 } }
    }
    const messageIdRange = createMessageIdRange(cursor, historyCutoffMessageId)
    if (messageIdRange) matchStage._id = messageIdRange

    const messages = await this.databaseService.messages
      .aggregate<MessageWithMediaInfo>([
        { $match: matchStage },
        { $sort: { _id: -1 } },
        {
          $lookup: {
            from: 'medias',
            localField: 'media_ids',
            foreignField: '_id',
            pipeline: [
              {
                $match: {
                  status: MediaStatus.Ready,
                  type: { $in: [MediaType.Image, MediaType.Video, MediaType.Audio] }
                }
              },
              {
                $project: {
                  _id: 1,
                  url: 1,
                  thumbnail: 1,
                  type: 1,
                  status: 1,
                  created_at: 1,
                  updated_at: 1
                }
              }
            ],
            as: 'medias_info'
          }
        },
        { $match: { 'medias_info.0': { $exists: true } } },
        { $limit: limit + 1 }
      ])
      .toArray()

    const has_next_page = messages.length > limit
    const pageMessages = await conversationMessageHydrationService.hydrateSenderInfo(
      messages.slice(0, limit),
      userId,
      historyCutoffMessageId
    )
    const next_cursor = has_next_page ? (pageMessages[pageMessages.length - 1]?._id?.toString() ?? null) : null

    return { messages: pageMessages, next_cursor, has_next_page }
  }

  async muteConversation(userId: string, conversationId: string, type: ConversationType, durationHours?: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId, type)

    let until: Date | null = null
    if (durationHours && durationHours > 0) {
      until = new Date()
      until.setHours(until.getHours() + durationHours)
    }

    const muteObj = { user_id: uId, until }
    const mutedAt = new Date()
    const muteUpdatePipeline: Document[] = [
      {
        $set: {
          muted_by: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$muted_by', []] },
                  as: 'mute',
                  cond: { $ne: ['$$mute.user_id', uId] }
                }
              },
              [muteObj]
            ]
          },
          updated_at: mutedAt
        }
      }
    ]

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        {
          _id: convId,
          $or: [{ user1_id: uId }, { user2_id: uId }],
          hidden_by: { $ne: uId }
        },
        muteUpdatePipeline
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': uId, hidden_by: { $ne: uId } },
        muteUpdatePipeline
      )
    }
    return { success: true, until }
  }

  async unmuteConversation(userId: string, conversationId: string, type: ConversationType) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId, type)

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: uId }, { user2_id: uId }] },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': uId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
    }
    return { success: true }
  }

  async updateGroupInfo(userId: string, conversationId: string, updates: { name?: string; avatar_url?: string }) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const userObjectId = new this.databaseService.ObjectId(userId)
    const access = await conversationAccessService.assertGroupAdmin(userId, conversationId)

    const validUpdates: { name?: string; avatar_url?: string; updated_at?: Date } = {}
    if (updates.name !== undefined) validUpdates.name = updates.name.trim()
    if (updates.avatar_url) validUpdates.avatar_url = updates.avatar_url

    if (Object.keys(validUpdates).length === 0) return { success: true }
    validUpdates.updated_at = new Date()

    const result = await this.databaseService.groupConversations.updateOne(
      { _id: convId, members: { $elemMatch: { user_id: userObjectId, role: 'admin' } } },
      { $set: validUpdates }
    )

    if (result.matchedCount === 0) {
      throw new HttpError('Only group admins can update group information', HTTP_STATUS.FORBIDDEN)
    }

    if (result.modifiedCount > 0) {
      this.emitGroupUpdate(access.memberIds, {
        conversation_id: conversationId,
        change_type: 'info_updated',
        actor_id: userId,
        affected_user_ids: []
      })
    }

    return { success: true }
  }

  async getGroupMembers(userId: string, conversationId: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const userObjectId = new this.databaseService.ObjectId(userId)
    await conversationAccessService.assertConversationMember(userId, conversationId, 'group')

    const group = await this.databaseService.groupConversations
      .aggregate([
        { $match: { _id: convId, 'members.user_id': userObjectId } },
        { $unwind: '$members' },
        {
          $lookup: {
            from: 'users',
            localField: 'members.user_id',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        { $unwind: '$userInfo' },
        {
          $group: {
            _id: '$_id',
            members: {
              $push: {
                role: '$members.role',
                joined_at: '$members.joined_at',
                user: {
                  _id: '$userInfo._id',
                  name: '$userInfo.name',
                  username: '$userInfo.username',
                  avatar: '$userInfo.avatar'
                }
              }
            }
          }
        }
      ])
      .toArray()

    return group.length > 0 ? group[0].members : []
  }

  async addGroupMembers(userId: string, conversationId: string, membersIds: string[]) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const userObjectId = new this.databaseService.ObjectId(userId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId, 'group')
    const uniqueMemberIds = [...new Set(membersIds)]
    const memberObjectIds = uniqueMemberIds.map((id) => new this.databaseService.ObjectId(id))
    const [existingUsers, followRelations] = await Promise.all([
      this.databaseService.users.find({ _id: { $in: memberObjectIds } }, { projection: { _id: 1 } }).toArray(),
      this.databaseService.followers
        .find(
          {
            follow_user_id: userObjectId,
            followed_user_id: { $in: memberObjectIds }
          },
          { projection: { followed_user_id: 1 } }
        )
        .toArray()
    ])

    if (existingUsers.length !== memberObjectIds.length) {
      throw new HttpError('One or more users do not exist', HTTP_STATUS.BAD_REQUEST)
    }

    const followedUserIds = new Set(followRelations.map((relation) => relation.followed_user_id.toString()))
    if (uniqueMemberIds.some((memberId) => !followedUserIds.has(memberId))) {
      throw new HttpError('You can only add users you follow', HTTP_STATUS.BAD_REQUEST)
    }

    const joinedAt = new Date()
    const requestedMembers = memberObjectIds.map((memberObjectId) => ({
      user_id: memberObjectId,
      role: 'member' as const,
      joined_at: joinedAt
    }))
    const previousGroup = await this.databaseService.groupConversations.findOneAndUpdate(
      {
        _id: convId,
        'members.user_id': userObjectId
      },
      [
        {
          $set: {
            members: {
              $concatArrays: [
                '$members',
                {
                  $filter: {
                    input: requestedMembers,
                    as: 'requestedMember',
                    cond: { $not: [{ $in: ['$$requestedMember.user_id', '$members.user_id'] }] }
                  }
                }
              ]
            },
            hidden_by: {
              $filter: {
                input: { $ifNull: ['$hidden_by', []] },
                as: 'hiddenUserId',
                cond: { $not: [{ $in: ['$$hiddenUserId', memberObjectIds] }] }
              }
            },
            updated_at: joinedAt
          }
        }
      ],
      { returnDocument: 'before', projection: { members: 1 } }
    )

    if (!previousGroup) {
      throw new HttpError('Only current group members can add members', HTTP_STATUS.FORBIDDEN)
    }

    const previousMemberIds = new Set(previousGroup.members.map((member) => member.user_id.toString()))
    const addedMemberIds = uniqueMemberIds.filter((memberId) => !previousMemberIds.has(memberId))

    if (addedMemberIds.length > 0) {
      await this.syncGroupMembership([...access.memberIds, ...addedMemberIds], {
        conversation_id: conversationId,
        change_type: 'members_added',
        actor_id: userId,
        affected_user_ids: addedMemberIds
      })
    }

    return { success: true }
  }

  async removeGroupMember(adminId: string, conversationId: string, userIdToRemove: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userIdToRemove)
    const adminObjectId = new this.databaseService.ObjectId(adminId)
    const access = await conversationAccessService.assertGroupAdmin(adminId, conversationId)

    if (adminId === userIdToRemove) {
      throw new HttpError(
        'Use the leave endpoint instead of removing yourself',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        GROUP_ADMIN_CANNOT_REMOVE_SELF_CODE
      )
    }

    if (!access.memberIds.includes(userIdToRemove)) {
      throw new HttpError('Group member not found', HTTP_STATUS.NOT_FOUND)
    }

    const result = await this.databaseService.groupConversations.updateOne(
      {
        _id: convId,
        members: { $elemMatch: { user_id: adminObjectId, role: 'admin' } },
        'members.user_id': uId
      },
      [
        {
          $set: {
            members: {
              $filter: {
                input: '$members',
                as: 'member',
                cond: { $ne: ['$$member.user_id', uId] }
              }
            },
            hidden_by: {
              $filter: {
                input: { $ifNull: ['$hidden_by', []] },
                as: 'hiddenUserId',
                cond: { $ne: ['$$hiddenUserId', uId] }
              }
            },
            pinned_by: {
              $filter: {
                input: { $ifNull: ['$pinned_by', []] },
                as: 'pinnedUserId',
                cond: { $ne: ['$$pinnedUserId', uId] }
              }
            },
            muted_by: {
              $filter: {
                input: { $ifNull: ['$muted_by', []] },
                as: 'mute',
                cond: { $ne: ['$$mute.user_id', uId] }
              }
            },
            updated_at: new Date()
          }
        }
      ]
    )

    if (result.modifiedCount === 0) {
      throw new HttpError('Group membership changed. Refresh and try again', HTTP_STATUS.CONFLICT)
    }

    await this.syncGroupMembership(access.memberIds, {
      conversation_id: conversationId,
      change_type: 'member_removed',
      actor_id: adminId,
      affected_user_ids: [userIdToRemove]
    })

    return { success: true }
  }

  async leaveGroup(userId: string, conversationId: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)
    const access = await conversationAccessService.assertConversationMember(userId, conversationId, 'group')
    if (access.type !== 'group') {
      throw new HttpError('Conversation is not a group', HTTP_STATUS.BAD_REQUEST)
    }

    const leavingMember = access.conversation.members.find((member) => member.user_id.equals(uId))
    const otherAdmins = access.conversation.members.filter(
      (member) => member.role === 'admin' && !member.user_id.equals(uId)
    )

    if (leavingMember?.role === 'admin' && access.conversation.members.length > 1 && otherAdmins.length === 0) {
      throw new HttpError(
        'Remove the remaining members before leaving as the sole admin',
        HTTP_STATUS.CONFLICT,
        undefined,
        GROUP_SOLE_ADMIN_CANNOT_LEAVE_CODE
      )
    }

    const adminLeaveGuard =
      leavingMember?.role === 'admin'
        ? {
            $or: [
              { 'members.1': { $exists: false } },
              { members: { $elemMatch: { role: 'admin', user_id: { $ne: uId } } } }
            ]
          }
        : {}
    const result = await this.databaseService.groupConversations.updateOne(
      { _id: convId, 'members.user_id': uId, ...adminLeaveGuard },
      [
        {
          $set: {
            members: {
              $filter: {
                input: '$members',
                as: 'member',
                cond: { $ne: ['$$member.user_id', uId] }
              }
            },
            hidden_by: {
              $filter: {
                input: { $ifNull: ['$hidden_by', []] },
                as: 'hiddenUserId',
                cond: { $ne: ['$$hiddenUserId', uId] }
              }
            },
            pinned_by: {
              $filter: {
                input: { $ifNull: ['$pinned_by', []] },
                as: 'pinnedUserId',
                cond: { $ne: ['$$pinnedUserId', uId] }
              }
            },
            muted_by: {
              $filter: {
                input: { $ifNull: ['$muted_by', []] },
                as: 'mute',
                cond: { $ne: ['$$mute.user_id', uId] }
              }
            },
            updated_at: new Date()
          }
        }
      ]
    )

    if (result.modifiedCount === 0) {
      throw new HttpError(
        'Group membership changed; refresh and try again',
        HTTP_STATUS.CONFLICT,
        undefined,
        GROUP_SOLE_ADMIN_CANNOT_LEAVE_CODE
      )
    }

    await this.syncGroupMembership(access.memberIds, {
      conversation_id: conversationId,
      change_type: 'member_left',
      actor_id: userId,
      affected_user_ids: [userId]
    })

    return { success: true }
  }

  async transferAdminAndLeave(adminId: string, conversationId: string, successorUserId: string) {
    if (adminId === successorUserId) {
      throw new HttpError(
        'Choose another group member as the new admin',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        GROUP_ADMIN_SUCCESSOR_INVALID_CODE
      )
    }

    const convId = new this.databaseService.ObjectId(conversationId)
    const adminObjectId = new this.databaseService.ObjectId(adminId)
    const successorObjectId = new this.databaseService.ObjectId(successorUserId)
    const access = await conversationAccessService.assertGroupAdmin(adminId, conversationId)
    const successor = access.conversation.members.find((member) => member.user_id.equals(successorObjectId))
    const adminCount = access.conversation.members.filter((member) => member.role === 'admin').length

    if (!successor || successor.role !== 'member') {
      throw new HttpError(
        'The selected successor is not an eligible group member',
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        GROUP_ADMIN_SUCCESSOR_INVALID_CODE
      )
    }

    if (adminCount !== 1) {
      throw new HttpError(
        'Group admin state changed; refresh and try again',
        HTTP_STATUS.CONFLICT,
        undefined,
        GROUP_ADMIN_TRANSFER_CONFLICT_CODE
      )
    }

    const updatedAt = new Date()
    const result = await this.databaseService.groupConversations.updateOne(
      {
        _id: convId,
        members: { $elemMatch: { user_id: adminObjectId, role: 'admin' } },
        $and: [
          { members: { $elemMatch: { user_id: successorObjectId, role: 'member' } } },
          {
            $expr: {
              $eq: [
                {
                  $size: {
                    $filter: {
                      input: '$members',
                      as: 'member',
                      cond: { $eq: ['$$member.role', 'admin'] }
                    }
                  }
                },
                1
              ]
            }
          }
        ]
      },
      [
        {
          $set: {
            members: {
              $map: {
                input: {
                  $filter: {
                    input: '$members',
                    as: 'member',
                    cond: { $ne: ['$$member.user_id', adminObjectId] }
                  }
                },
                as: 'member',
                in: {
                  $cond: [
                    { $eq: ['$$member.user_id', successorObjectId] },
                    { $mergeObjects: ['$$member', { role: 'admin' }] },
                    '$$member'
                  ]
                }
              }
            },
            hidden_by: {
              $filter: {
                input: { $ifNull: ['$hidden_by', []] },
                as: 'hiddenUserId',
                cond: { $ne: ['$$hiddenUserId', adminObjectId] }
              }
            },
            pinned_by: {
              $filter: {
                input: { $ifNull: ['$pinned_by', []] },
                as: 'pinnedUserId',
                cond: { $ne: ['$$pinnedUserId', adminObjectId] }
              }
            },
            muted_by: {
              $filter: {
                input: { $ifNull: ['$muted_by', []] },
                as: 'mute',
                cond: { $ne: ['$$mute.user_id', adminObjectId] }
              }
            },
            updated_at: updatedAt
          }
        }
      ]
    )

    if (result.modifiedCount === 0) {
      throw new HttpError(
        'Group membership changed; refresh and choose the new admin again',
        HTTP_STATUS.CONFLICT,
        undefined,
        GROUP_ADMIN_TRANSFER_CONFLICT_CODE
      )
    }

    await this.syncGroupMembership(access.memberIds, {
      conversation_id: conversationId,
      change_type: 'admin_transferred',
      actor_id: adminId,
      affected_user_ids: [adminId, successorUserId]
    })

    return { success: true }
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const message = await this.databaseService.messages.findOne({ _id: msgId })
    if (!message) throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)

    if (!message.sender_id.equals(objectIdUserId)) {
      throw new HttpError('You can only edit your own messages', HTTP_STATUS.FORBIDDEN)
    }

    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $set: { content, is_edited: true, updated_at: new Date() } } // assuming schema allows is_edited
    )

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:edited', { message_id: messageId, content })
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

    return { success: true }
  }

  async unreactMessage(userId: string, messageId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const { message, conversation } = await conversationMessageAccessService.assertMessageAccess(
      userId,
      messageId,
      { requireVisibleToUser: true, allowedStatuses: ['sent'] }
    )
    const reactionUpdatePipeline: Document[] = [
      {
        $set: {
          reactions: {
            $filter: {
              input: { $ifNull: ['$reactions', []] },
              as: 'reaction',
              cond: { $ne: ['$$reaction.user_id', objectIdUserId] }
            }
          }
        }
      }
    ]
    const updatedMessage = await this.databaseService.messages.findOneAndUpdate(
      {
        _id: msgId,
        status: 'sent',
        deleted_by: { $ne: objectIdUserId }
      },
      reactionUpdatePipeline,
      { returnDocument: 'after', projection: { reactions: 1 } }
    )
    if (!updatedMessage) {
      throw new HttpError('Message state changed before its reaction could be removed', HTTP_STATUS.CONFLICT)
    }

    const conversationId = message.conversation_id.toString()
    const reactionState = createMessageReactionState(updatedMessage.reactions)
    const reactionEvent: MessageReactionUpdatedEvent = {
      conversation_id: conversationId,
      message_id: messageId,
      ...reactionState
    }
    await conversationMessageSyncService.syncConversationAction(
      conversationId,
      conversation.memberIds,
      '@message:reaction-updated',
      reactionEvent
    )

    return reactionState
  }

  async getMessageReactions(userId: string, messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)
    await conversationMessageAccessService.assertMessageAccess(userId, messageId, {
      requireVisibleToUser: true,
      allowedStatuses: ['sent']
    })

    const message = await this.databaseService.messages
      .aggregate([
        {
          $match: {
            _id: msgId,
            status: 'sent',
            deleted_by: { $ne: new this.databaseService.ObjectId(userId) }
          }
        },
        { $unwind: '$reactions' },
        {
          $lookup: {
            from: 'users',
            localField: 'reactions.user_id',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        { $unwind: '$userInfo' },
        {
          $project: {
            _id: 0,
            emoji: '$reactions.emoji',
            user: {
              _id: '$userInfo._id',
              name: '$userInfo.name',
              username: '$userInfo.username',
              avatar: '$userInfo.avatar'
            }
          }
        }
      ])
      .toArray()

    return message.filter((reaction) => isMessageReactionEmoji(reaction.emoji))
  }

  async forwardMessage(userId: string, messageId: string, conversationIds: string[]) {
    const senderId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const originalMessage = await this.databaseService.messages.findOne({ _id: msgId })
    if (!originalMessage) {
      throw new HttpError('Original message not found', HTTP_STATUS.NOT_FOUND)
    }

    await conversationAccessService.assertConversationMember(
      userId,
      originalMessage.conversation_id.toString(),
      originalMessage.conversation_type
    )

    if (originalMessage.status !== 'sent') {
      throw new HttpError('Only sent messages can be forwarded', HTTP_STATUS.BAD_REQUEST)
    }
    if (originalMessage.deleted_by?.some((deletedByUserId) => deletedByUserId.toString() === userId)) {
      throw new HttpError('Message is not available for this action', HTTP_STATUS.BAD_REQUEST)
    }

    const normalizedConversationIds = conversationIds.map((conversationId) =>
      new this.databaseService.ObjectId(conversationId).toString()
    )
    const targetConversations = await Promise.all(
      normalizedConversationIds.map((conversationId) =>
        conversationAccessService.assertConversationMember(userId, conversationId)
      )
    )

    await Promise.all(
      targetConversations.map((targetConversation) => {
        if (targetConversation.type !== 'direct') return Promise.resolve()

        const partnerId = targetConversation.memberIds.find((memberId) => memberId !== userId)
        if (!partnerId) {
          throw new HttpError('Direct conversation partner not found', HTTP_STATUS.NOT_FOUND)
        }

        return conversationAccessService.assertDirectMessagingAllowed(userId, partnerId)
      })
    )

    const targetConversationTypeById = new Map(
      normalizedConversationIds.map((conversationId, index) => [conversationId, targetConversations[index].type])
    )

    const firstMedia = originalMessage.media_ids?.[0]
      ? await this.databaseService.medias.findOne({ _id: originalMessage.media_ids[0] })
      : null
    const forwardedMessageType =
      firstMedia?.type === MediaType.Image ||
      firstMedia?.type === MediaType.Video ||
      firstMedia?.type === MediaType.Audio
        ? firstMedia.type
        : firstMedia
          ? ('file' as const)
          : ('text' as const)

    const newMessages = normalizedConversationIds.map((conversationId) => {
      const conversationType = targetConversationTypeById.get(conversationId)

      if (!conversationType) {
        throw new HttpError('Conversation not found', HTTP_STATUS.NOT_FOUND)
      }

      const newMessage = new Message({
        _id: new this.databaseService.ObjectId(),
        conversation_id: new this.databaseService.ObjectId(conversationId),
        conversation_type: conversationType,
        sender_id: senderId,
        content: originalMessage.content,
        media_ids: originalMessage.media_ids,
        send_at: new Date(),
        read_by: [],
        reactions: [],
        status: 'sent',
        ...{ is_forwarded: true }
      })
      return newMessage
    })

    if (newMessages.length > 0) {
      await conversationAccessService.assertConversationMember(
        userId,
        originalMessage.conversation_id.toString(),
        originalMessage.conversation_type
      )
      await Promise.all(
        normalizedConversationIds.map((conversationId) =>
          conversationAccessService.assertConversationMember(userId, conversationId)
        )
      )

      await this.databaseService.messages.insertMany(newMessages)

      // Update last_message_preview for all conversations
      const updatePromises = normalizedConversationIds.map((conversationId, index) => {
        const conversationObjectId = new this.databaseService.ObjectId(conversationId)
        const forwardedMessage = newMessages[index]
        if (!forwardedMessage?._id) {
          throw new HttpError('Forwarded message could not be created', HTTP_STATUS.INTERNAL_SERVER_ERROR)
        }
        const preview = {
          message_id: forwardedMessage._id,
          sender_id: senderId,
          content: originalMessage.content,
          message_type: forwardedMessageType
        }
        const update = {
          $set: {
            last_message_at: forwardedMessage.send_at ?? new Date(),
            last_message_preview: preview,
            last_message_overrides: [],
            updated_at: new Date()
          }
        }

        if (targetConversationTypeById.get(conversationId) === 'direct') {
          return this.databaseService.directConversations.updateOne(
            { _id: conversationObjectId, $or: [{ user1_id: senderId }, { user2_id: senderId }] },
            update
          )
        }

        return this.databaseService.groupConversations.updateOne(
          { _id: conversationObjectId, 'members.user_id': senderId },
          update
        )
      })

      await Promise.all(updatePromises)
    }

    return { success: true }
  }
}

const conversationService = new ConversationService()
export default conversationService
