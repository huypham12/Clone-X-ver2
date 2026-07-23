import DatabaseService from '~/config/database.service'
import { ObjectId } from 'mongodb'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import redisService from '~/config/redis.service'

class ConversationService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  async getConversations(userId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)

    const [directs, groups] = await Promise.all([
      this.databaseService.directConversations
        .find({
          $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }],
          hidden_by: { $ne: objectIdUserId }
        })
        .toArray(),
      this.databaseService.groupConversations
        .find({
          'members.user_id': objectIdUserId,
          hidden_by: { $ne: objectIdUserId }
        })
        .toArray()
    ])

    // Normalize format
    const formattedDirects = directs.map((c) => ({
      ...c,
      type: 'direct',
      partner_id: c.user1_id.equals(objectIdUserId) ? c.user2_id : c.user1_id,
      is_pinned: c.pinned_by?.some((id) => id.equals(objectIdUserId)) || false
    }))

    const formattedGroups = groups.map((c) => ({
      ...c,
      type: 'group',
      is_pinned: c.pinned_by?.some((id) => id.equals(objectIdUserId)) || false
    }))

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

    // Ensure user1_id < user2_id to maintain consistency
    const [u1, u2] = user1_id < user2_id ? [id1, id2] : [id2, id1]

    let conversation = await this.databaseService.directConversations.findOne({
      user1_id: u1,
      user2_id: u2
    })

    if (!conversation) {
      const newConversation = new DirectConversation({
        _id: new this.databaseService.ObjectId(),
        user1_id: u1,
        user2_id: u2,
        last_message_at: new Date(),
        last_message_preview: { sender_id: id1, content: 'Conversation started', message_type: 'text' }
      })
      await this.databaseService.directConversations.insertOne(newConversation)
      return newConversation
    } else if (conversation.hidden_by?.some((id) => id.equals(id1) || id.equals(id2))) {
      // If one of them hidden it, unhide when someone starts chatting again
      await this.databaseService.directConversations.updateOne(
        { _id: conversation._id },
        { $set: { hidden_by: [] } }
      )
    }

    return conversation
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

    // Try Direct
    const directUpdate = await this.databaseService.directConversations.updateOne(
      { _id: convId },
      { $addToSet: { hidden_by: objectIdUserId } }
    )

    if (directUpdate.matchedCount > 0) return { success: true }

    // Try Group
    const groupUpdate = await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $addToSet: { hidden_by: objectIdUserId } }
    )

    if (groupUpdate.matchedCount > 0) return { success: true }

    throw new HttpError('Conversation not found', HTTP_STATUS.NOT_FOUND)
  }

  async getMessages(conversationId: string, page: number, limit: number) {
    const redisKey = `chat:messages:${conversationId}`
    const start = (page - 1) * limit
    const end = start + limit - 1

    // Try Redis first (ZREVRANGE gives descending order)
    const cachedMessages = await redisService.clientInstance.zRange(redisKey, start, end, { REV: true })

    if (cachedMessages && cachedMessages.length === limit) {
      return cachedMessages.map((msg: string) => JSON.parse(msg))
    }

    // Fallback to MongoDB
    const convId = new this.databaseService.ObjectId(conversationId)
    const messages = await this.databaseService.messages
      .find({ conversation_id: convId })
      .sort({ send_at: -1 }) // Newest first
      .skip(start)
      .limit(limit)
      .toArray()

    return messages
  }

  async markAsRead(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)

    await this.databaseService.messages.updateMany(
      { conversation_id: convId, read_by: { $ne: objectIdUserId } },
      { $addToSet: { read_by: objectIdUserId } }
    )

    return { success: true }
  }

  async revokeMessage(userId: string, messageId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const message = await this.databaseService.messages.findOne({ _id: msgId })
    if (!message) throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)
    if (!message.sender_id.equals(objectIdUserId)) {
      throw new HttpError('You can only revoke your own messages', HTTP_STATUS.FORBIDDEN)
    }

    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $set: { status: 'revoked' } }
    )

    // TODO: Ideally we should update cache too. For simplicity, just invalidating cache is an option, or leave it to TTL.
    return { success: true }
  }

  async deleteMessage(userId: string, messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)

    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $set: { status: 'deleted' } }
    )
    return { success: true }
  }

  async reactMessage(userId: string, messageId: string, emoji: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const reaction = { emoji, user_id: objectIdUserId }

    // Xóa reaction cũ của user này nếu có (nếu thiết kế 1 người 1 reaction), hoặc cứ push. Ở đây push.
    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $pull: { reactions: { user_id: objectIdUserId } } as any } // Xóa cũ
    )
    
    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $push: { reactions: reaction } as any } // Thêm mới
    )

    return { success: true }
  }

  async pinConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)

    // Check total pinned count
    const [pinnedDirectsCount, pinnedGroupsCount] = await Promise.all([
      this.databaseService.directConversations.countDocuments({ pinned_by: objectIdUserId }),
      this.databaseService.groupConversations.countDocuments({ pinned_by: objectIdUserId })
    ])

    if (pinnedDirectsCount + pinnedGroupsCount >= 5) {
      throw new HttpError('Maximum 5 pinned conversations allowed', HTTP_STATUS.BAD_REQUEST)
    }

    // Try Direct
    const directUpdate = await this.databaseService.directConversations.updateOne(
      { _id: convId },
      { $addToSet: { pinned_by: objectIdUserId } }
    )

    if (directUpdate.matchedCount > 0) return { success: true }

    // Try Group
    const groupUpdate = await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $addToSet: { pinned_by: objectIdUserId } }
    )

    if (groupUpdate.matchedCount > 0) return { success: true }

    throw new HttpError('Conversation not found', HTTP_STATUS.NOT_FOUND)
  }

  async unpinConversation(userId: string, conversationId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const convId = new this.databaseService.ObjectId(conversationId)

    // Try Direct
    const directUpdate = await this.databaseService.directConversations.updateOne(
      { _id: convId },
      { $pull: { pinned_by: objectIdUserId } } as any
    )

    if (directUpdate.matchedCount > 0) return { success: true }

    // Try Group
    const groupUpdate = await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $pull: { pinned_by: objectIdUserId } } as any
    )

    if (groupUpdate.matchedCount > 0) return { success: true }

    throw new HttpError('Conversation not found', HTTP_STATUS.NOT_FOUND)
  }

  async searchMessages(userId: string, conversationId: string, q: string, page: number, limit: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const skip = (page - 1) * limit

    const messages = await this.databaseService.messages
      .find({
        conversation_id: convId,
        $text: { $search: q }
      })
      .project({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(limit)
      .toArray()

    const total = await this.databaseService.messages.countDocuments({
      conversation_id: convId,
      $text: { $search: q }
    })

    return { messages, total, page, totalPages: Math.ceil(total / limit) }
  }

  async getConversationMedia(userId: string, conversationId: string, page: number, limit: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const skip = (page - 1) * limit

    const messages = await this.databaseService.messages
      .find({
        conversation_id: convId,
        media_ids: { $exists: true, $not: { $size: 0 } }
      })
      .sort({ send_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray()

    const total = await this.databaseService.messages.countDocuments({
      conversation_id: convId,
      media_ids: { $exists: true, $not: { $size: 0 } }
    })

    return { messages, total, page, totalPages: Math.ceil(total / limit) }
  }

  async muteConversation(userId: string, conversationId: string, type: 'direct' | 'group', durationHours?: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)
    
    let until: Date | null = null
    if (durationHours && durationHours > 0) {
      until = new Date()
      until.setHours(until.getHours() + durationHours)
    }

    const muteObj = { user_id: uId, until }

    if (type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
      await this.databaseService.directConversations.updateOne(
        { _id: convId },
        { $push: { muted_by: muteObj } as any }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
      await this.databaseService.groupConversations.updateOne(
        { _id: convId },
        { $push: { muted_by: muteObj } as any }
      )
    }
    return { success: true, until }
  }

  async unmuteConversation(userId: string, conversationId: string, type: 'direct' | 'group') {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)

    if (type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
    }
    return { success: true }
  }
}

const conversationService = new ConversationService()
export default conversationService
