import { HttpError } from '~/common/http-error'
import DatabaseService from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type DirectConversation from '~/schemas/DirectConversation.schema'
import type GroupConversation from '~/schemas/GroupConversation.schema'

export type ConversationType = 'direct' | 'group'

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

class ConversationAccessService {
  private readonly databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  async resolveConversation(
    conversationId: string,
    expectedType?: ConversationType
  ): Promise<ResolvedConversation> {
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
}

const conversationAccessService = new ConversationAccessService()

export default conversationAccessService
