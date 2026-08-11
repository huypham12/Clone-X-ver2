import { ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { ConversationSystemEventType, MessageKind, UserVerifyStatus } from '~/constants/enums'
import type Message from '~/schemas/Message.schema'
import type { MessageSenderInfo } from './dto'

type MessagePreviewType = 'text' | 'image' | 'video' | 'audio' | 'file'

interface StoredConversationPreview {
  message_id?: ObjectId
  sender_id: ObjectId
  content: string
  message_type: MessagePreviewType
}

interface ConversationWithPreview {
  last_message_preview: StoredConversationPreview
}

export interface PublicConversationPreview extends StoredConversationPreview {
  kind: MessageKind | null
  system_event_type: ConversationSystemEventType | null
  sender_info: MessageSenderInfo | null
}

type ConversationWithPublicPreview<TConversation extends ConversationWithPreview> = Omit<
  TConversation,
  'last_message_preview'
> & {
  last_message_preview: PublicConversationPreview
}

type PreviewMessage = Pick<Message, 'sender_id' | 'kind' | 'system_event_type'> & {
  _id: ObjectId
}

export class ConversationPreviewHydrationService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async hydrate<TConversation extends ConversationWithPreview>(
    conversations: TConversation[],
    viewerUserId: string
  ): Promise<ConversationWithPublicPreview<TConversation>[]> {
    if (conversations.length === 0) return []

    const messageIds = [
      ...new Map(
        conversations.flatMap((conversation) => {
          const messageId = conversation.last_message_preview.message_id
          return messageId ? [[messageId.toHexString(), messageId] as const] : []
        })
      ).values()
    ]
    const messages: PreviewMessage[] = messageIds.length
      ? await this.databaseService.messages
          .find(
            { _id: { $in: messageIds } },
            {
              projection: {
                _id: 1,
                sender_id: 1,
                kind: 1,
                system_event_type: 1
              }
            }
          )
          .toArray()
      : []
    const messageById = new Map(messages.map((message) => [message._id.toHexString(), message]))
    const userMessageSenderIds = [
      ...new Map(
        messages.flatMap((message) => {
          const kind = message.kind === MessageKind.System ? MessageKind.System : MessageKind.User
          return kind === MessageKind.User ? [[message.sender_id.toHexString(), message.sender_id] as const] : []
        })
      ).values()
    ]
    const viewerId = new this.databaseService.ObjectId(viewerUserId)
    const otherSenderIds = userMessageSenderIds.filter((senderId) => !senderId.equals(viewerId))
    const [users, blockEdges] = await Promise.all([
      userMessageSenderIds.length
        ? this.databaseService.users
            .find(
              {
                _id: { $in: userMessageSenderIds },
                verify: { $ne: UserVerifyStatus.Banned }
              },
              { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      otherSenderIds.length
        ? this.databaseService.userBlocks
            .find(
              {
                $or: [
                  { user_id: viewerId, blocked_user_id: { $in: otherSenderIds } },
                  { user_id: { $in: otherSenderIds }, blocked_user_id: viewerId }
                ]
              },
              { projection: { user_id: 1, blocked_user_id: 1 } }
            )
            .toArray()
        : Promise.resolve([])
    ])
    const blockedSenderIds = new Set(
      blockEdges.map((edge) =>
        edge.user_id.equals(viewerId) ? edge.blocked_user_id.toHexString() : edge.user_id.toHexString()
      )
    )
    const senderInfoById = new Map<string, MessageSenderInfo>(
      users.flatMap((user) => {
        const userId = user._id.toHexString()
        return blockedSenderIds.has(userId)
          ? []
          : [
              [
                userId,
                {
                  _id: user._id,
                  name: user.name,
                  username: user.username,
                  avatar: user.avatar
                }
              ] as const
            ]
      })
    )

    return conversations.map((conversation) => {
      const preview = conversation.last_message_preview
      const message = preview.message_id ? messageById.get(preview.message_id.toHexString()) : undefined
      if (!message) {
        return {
          ...conversation,
          last_message_preview: {
            ...preview,
            kind: null,
            system_event_type: null,
            sender_info: null
          }
        }
      }

      const kind = message.kind === MessageKind.System ? MessageKind.System : MessageKind.User
      return {
        ...conversation,
        last_message_preview: {
          ...preview,
          sender_id: message.sender_id,
          kind,
          system_event_type: kind === MessageKind.System ? (message.system_event_type ?? null) : null,
          sender_info: kind === MessageKind.User ? (senderInfoById.get(message.sender_id.toHexString()) ?? null) : null
        }
      }
    })
  }
}

const conversationPreviewHydrationService = new ConversationPreviewHydrationService()

export default conversationPreviewHydrationService
