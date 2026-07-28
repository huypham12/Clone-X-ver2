import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import { MediaType } from '~/constants/enums'
import type Message from '~/schemas/Message.schema'
import type {
  HydratedMessage,
  MessageReplyMediaType,
  MessageReplyPreview,
  MessageSenderInfo,
  MessageWithMediaInfo
} from './dto'

const REPLY_PREVIEW_CONTENT_LIMIT = 140
type ReplyMessage = Pick<
  Message,
  'conversation_id' | 'conversation_type' | 'sender_id' | 'content' | 'media_ids' | 'status'
> & { _id: ObjectId }

const isReplyMediaType = (type: MediaType): type is MessageReplyMediaType =>
  type === MediaType.Image || type === MediaType.Video || type === MediaType.Audio

export class ConversationMessageHydrationService {
  private readonly databaseService: DatabaseService

  constructor(databaseService: DatabaseService = new DatabaseService()) {
    this.databaseService = databaseService
  }

  async hydrateSenderInfo(messages: MessageWithMediaInfo[]): Promise<HydratedMessage[]> {
    if (messages.length === 0) return []

    const replyIds = [
      ...new Set(
        messages
          .map((message) => message.reply_to_message_id?.toString())
          .filter((replyId): replyId is string => typeof replyId === 'string' && ObjectId.isValid(replyId))
      )
    ]
    const replyObjectIds = replyIds.map((replyId) => new this.databaseService.ObjectId(replyId))
    const replyMessages: ReplyMessage[] = replyObjectIds.length
      ? await this.databaseService.messages
          .find(
            { _id: { $in: replyObjectIds }, status: { $in: ['sent', 'revoked'] } },
            {
              projection: {
                _id: 1,
                conversation_id: 1,
                conversation_type: 1,
                sender_id: 1,
                content: 1,
                media_ids: 1,
                status: 1
              }
            }
          )
          .toArray()
      : []
    const senderIds = [
      ...new Set(
        [...messages.map((message) => message.sender_id), ...replyMessages.map((reply) => reply.sender_id)]
          .map((senderId) => senderId.toString())
          .filter((senderId) => ObjectId.isValid(senderId))
      )
    ]
    const senderObjectIds = senderIds.map((senderId) => new this.databaseService.ObjectId(senderId))
    const firstReplyMediaIds = replyMessages
      .filter((reply) => reply.status === 'sent')
      .map((reply) => reply.media_ids[0])
      .filter((mediaId): mediaId is ObjectId => Boolean(mediaId))
    const [users, replyMedias] = await Promise.all([
      this.databaseService.users
        .find({ _id: { $in: senderObjectIds } }, { projection: { _id: 1, name: 1, username: 1, avatar: 1 } })
        .toArray(),
      firstReplyMediaIds.length
        ? this.databaseService.medias
            .find(
              { _id: { $in: firstReplyMediaIds } },
              { projection: { _id: 1, type: 1 } }
            )
            .toArray()
        : Promise.resolve([])
    ])
    const senderInfoById = new Map<string, MessageSenderInfo>(
      users.map((user) => [
        user._id.toString(),
        {
          _id: user._id,
          name: user.name,
          username: user.username,
          avatar: user.avatar
        }
      ])
    )
    const replyMessageById = new Map<string, ReplyMessage>(
      replyMessages.map((replyMessage) => [replyMessage._id.toString(), replyMessage])
    )
    const replyMediaTypeById = new Map<string, MessageReplyMediaType>(
      replyMedias.flatMap((media) =>
        isReplyMediaType(media.type) ? ([[media._id.toString(), media.type]] as const) : []
      )
    )

    return messages.map((message) => {
      const replyMessage = message.reply_to_message_id
        ? replyMessageById.get(message.reply_to_message_id.toString())
        : undefined
      const isReplyFromSameConversation =
        replyMessage?.conversation_id.toString() === message.conversation_id.toString() &&
        replyMessage.conversation_type === message.conversation_type
      let replyTo: MessageReplyPreview | null = null

      if (replyMessage && isReplyFromSameConversation) {
        const isRevoked = replyMessage.status === 'revoked'
        const firstMediaId = replyMessage.media_ids[0]?.toString()
        replyTo = {
          _id: replyMessage._id,
          sender_info: senderInfoById.get(replyMessage.sender_id.toString()) ?? null,
          content: isRevoked ? '' : replyMessage.content.trim().slice(0, REPLY_PREVIEW_CONTENT_LIMIT),
          ...(isRevoked || !firstMediaId
            ? {}
            : { media_type: replyMediaTypeById.get(firstMediaId) }),
          status: isRevoked ? 'revoked' : 'sent'
        }
      }

      if (message.status === 'revoked') {
        return {
          ...message,
          content: '',
          media_ids: [],
          medias_info: [],
          reactions: [],
          reply_to_message_id: undefined,
          sender_info: senderInfoById.get(message.sender_id.toString()) ?? null,
          reply_to: null
        }
      }

      return {
        ...message,
        sender_info: senderInfoById.get(message.sender_id.toString()) ?? null,
        reply_to: replyTo
      }
    })
  }

  async hydrateSingleMessage(message: MessageWithMediaInfo): Promise<HydratedMessage> {
    const [hydratedMessage] = await this.hydrateSenderInfo([message])
    return hydratedMessage
  }
}

const conversationMessageHydrationService = new ConversationMessageHydrationService()

export default conversationMessageHydrationService
