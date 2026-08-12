import { ObjectId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type DirectConversation from '~/schemas/DirectConversation.schema'
import type GroupConversation from '~/schemas/GroupConversation.schema'

export type ConversationType = 'direct' | 'group'

export const DIRECT_MESSAGE_BLOCKED_CODE = 'DIRECT_MESSAGE_BLOCKED' as const
export const DIRECT_MESSAGE_BLOCKED_MESSAGE = 'Direct messaging is unavailable because one user blocked the other'

type ResolvedDirectConversation = {
  type: 'direct'
  conversation: DirectConversation
  memberIds: string[]
}

type ResolvedGroupConversation = {
  type: 'group'
  conversation: GroupConversation
  memberIds: string[]
}

export type ResolvedConversation = ResolvedDirectConversation | ResolvedGroupConversation

type ConversationWithHistoryClear = Pick<DirectConversation | GroupConversation, 'history_cleared_by'>

export const getConversationHistoryCutoff = (conversation: ConversationWithHistoryClear, userId: string) =>
  conversation.history_cleared_by?.find((marker) => marker.user_id.toString() === userId)?.cleared_through_message_id ??
  undefined

export const isMessageAfterHistoryCutoff = (
  messageId: ObjectId,
  conversation: ConversationWithHistoryClear,
  userId: string
) => {
  const cutoff = getConversationHistoryCutoff(conversation, userId)
  return !cutoff || messageId.toString() > cutoff.toString()
}

class ConversationAccessService {
  private readonly databaseService: DatabaseService

  constructor(databaseService: DatabaseService = sharedDatabaseService) {
    this.databaseService = databaseService
  }

  async resolveConversation(conversationId: string, expectedType?: ConversationType): Promise<ResolvedConversation> {
    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const [directConversation, groupConversation] = await Promise.all([
      this.databaseService.directConversations.findOne({ _id: conversationObjectId }),
      this.databaseService.groupConversations.findOne({ _id: conversationObjectId })
    ])

    if (!directConversation && !groupConversation) {
      throw new HttpError('Conversation not found', HTTP_STATUS.NOT_FOUND)
    }

    const resolved: ResolvedConversation = directConversation
      ? {
          type: 'direct',
          conversation: directConversation,
          memberIds: [directConversation.user1_id.toString(), directConversation.user2_id.toString()]
        }
      : {
          type: 'group',
          conversation: groupConversation as GroupConversation,
          memberIds: (groupConversation as GroupConversation).members.map((member) => member.user_id.toString())
        }

    if (expectedType && resolved.type !== expectedType) {
      throw new HttpError('Conversation type does not match', HTTP_STATUS.BAD_REQUEST)
    }

    return resolved
  }

  async assertConversationMember(
    userId: string,
    conversationId: string,
    expectedType?: ConversationType
  ): Promise<ResolvedConversation> {
    const resolved = await this.resolveConversation(conversationId, expectedType)

    if (!resolved.memberIds.includes(userId)) {
      throw new HttpError('You are not a member of this conversation', HTTP_STATUS.FORBIDDEN)
    }

    return resolved
  }

  async assertGroupAdmin(userId: string, conversationId: string): Promise<ResolvedGroupConversation> {
    const resolved = await this.assertConversationMember(userId, conversationId, 'group')
    if (resolved.type !== 'group') {
      throw new HttpError('Conversation is not a group', HTTP_STATUS.BAD_REQUEST)
    }

    const isAdmin = resolved.conversation.members.some(
      (member) => member.user_id.toString() === userId && member.role === 'admin'
    )

    if (!isAdmin) {
      throw new HttpError('Only group admins can perform this action', HTTP_STATUS.FORBIDDEN)
    }

    return resolved
  }

  async isDirectMessagingBlocked(firstUserId: string, secondUserId: string): Promise<boolean> {
    const firstUserObjectId = new this.databaseService.ObjectId(firstUserId)
    const secondUserObjectId = new this.databaseService.ObjectId(secondUserId)
    const block = await this.databaseService.userBlocks.findOne(
      {
        $or: [
          { user_id: firstUserObjectId, blocked_user_id: secondUserObjectId },
          { user_id: secondUserObjectId, blocked_user_id: firstUserObjectId }
        ]
      },
      { projection: { _id: 1 } }
    )

    return Boolean(block)
  }

  async assertDirectMessagingAllowed(firstUserId: string, secondUserId: string): Promise<void> {
    if (await this.isDirectMessagingBlocked(firstUserId, secondUserId)) {
      throw new HttpError(DIRECT_MESSAGE_BLOCKED_MESSAGE, HTTP_STATUS.FORBIDDEN)
    }
  }
}

const conversationAccessService = new ConversationAccessService()

export default conversationAccessService
