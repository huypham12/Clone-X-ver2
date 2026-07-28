import { ObjectId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import DatabaseService from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type Message from '~/schemas/Message.schema'
import conversationAccessService, {
  type ConversationType,
  type ResolvedConversation
} from './conversation-access.service'

export const REPLY_MESSAGE_UNAVAILABLE_CODE = 'REPLY_MESSAGE_UNAVAILABLE' as const
export const REPLY_MESSAGE_UNAVAILABLE_MESSAGE =
  'The message you are replying to is unavailable in this conversation'

type MessageStatus = Message['status']

interface MessageAccessOptions {
  requireSender?: boolean
  requireVisibleToUser?: boolean
  allowedStatuses?: readonly MessageStatus[]
}

export interface ResolvedMessageAccess {
  message: Message
  conversation: ResolvedConversation
}

export class ConversationMessageAccessService {
  private readonly databaseService: DatabaseService
  private readonly accessService: Pick<typeof conversationAccessService, 'assertConversationMember'>

  constructor(
    databaseService: DatabaseService = new DatabaseService(),
    accessService: Pick<typeof conversationAccessService, 'assertConversationMember'> = conversationAccessService
  ) {
    this.databaseService = databaseService
    this.accessService = accessService
  }

  async assertMessageAccess(
    userId: string,
    messageId: string,
    options: MessageAccessOptions = {}
  ): Promise<ResolvedMessageAccess> {
    if (!ObjectId.isValid(messageId)) {
      throw new HttpError('Invalid message ID format', HTTP_STATUS.BAD_REQUEST)
    }

    const message = await this.databaseService.messages.findOne({
      _id: new this.databaseService.ObjectId(messageId)
    })
    if (!message) {
      throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)
    }

    const conversation = await this.accessService.assertConversationMember(
      userId,
      message.conversation_id.toString(),
      message.conversation_type
    )

    if (options.requireSender && message.sender_id.toString() !== userId) {
      throw new HttpError('You can only perform this action on your own messages', HTTP_STATUS.FORBIDDEN)
    }

    if (options.allowedStatuses && !options.allowedStatuses.includes(message.status)) {
      throw new HttpError('Message is not available for this action', HTTP_STATUS.BAD_REQUEST)
    }

    if (
      options.requireVisibleToUser &&
      message.deleted_by?.some((deletedByUserId) => deletedByUserId.toString() === userId)
    ) {
      throw new HttpError('Message is not available for this action', HTTP_STATUS.BAD_REQUEST)
    }

    return { message, conversation }
  }

  async assertReplyTargetAccess(
    userId: string,
    messageId: string,
    conversationId: string,
    conversationType: ConversationType
  ): Promise<Message> {
    await this.accessService.assertConversationMember(userId, conversationId, conversationType)

    if (!ObjectId.isValid(messageId)) {
      throw new HttpError(
        REPLY_MESSAGE_UNAVAILABLE_MESSAGE,
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        REPLY_MESSAGE_UNAVAILABLE_CODE
      )
    }

    const targetMessage = await this.databaseService.messages.findOne({
      _id: new this.databaseService.ObjectId(messageId)
    })
    const belongsToConversation =
      targetMessage?.conversation_id.toString() === conversationId &&
      targetMessage.conversation_type === conversationType

    const isDeletedForUser = targetMessage?.deleted_by?.some(
      (deletedByUserId) => deletedByUserId.toString() === userId
    )

    if (!targetMessage || !belongsToConversation || targetMessage.status !== 'sent' || isDeletedForUser) {
      throw new HttpError(
        REPLY_MESSAGE_UNAVAILABLE_MESSAGE,
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        REPLY_MESSAGE_UNAVAILABLE_CODE
      )
    }

    return targetMessage
  }
}

const conversationMessageAccessService = new ConversationMessageAccessService()

export default conversationMessageAccessService
