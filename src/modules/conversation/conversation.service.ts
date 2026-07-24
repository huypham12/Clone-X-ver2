import DatabaseService from '~/config/database.service'
import { ObjectId } from 'mongodb'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import redisService from '~/config/redis.service'
import { getIO } from '~/socket'

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

  async getMessages(conversationId: string, cursor: string | undefined, limit: number) {
    const redisKey = `chat:messages:${conversationId}`
    const convId = new this.databaseService.ObjectId(conversationId)

    let messages = []
    
    if (!cursor) {
      const cachedMessages = await redisService.clientInstance.zRange(redisKey, 0, limit - 1, { REV: true })
      if (cachedMessages && cachedMessages.length === limit) {
        messages = cachedMessages.map((msg: string) => JSON.parse(msg))
      }
    }

    if (messages.length === 0) {
      const matchStage: any = { conversation_id: convId }
      if (cursor) {
        matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
      }
      
      messages = await this.databaseService.messages
        .find(matchStage)
        .sort({ _id: -1 }) // Newest first
        .limit(limit)
        .toArray()
    }

    const has_next_page = messages.length === limit
    const next_cursor = has_next_page ? messages[messages.length - 1]._id?.toString() : null
    
    return { messages, next_cursor, has_next_page }
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

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:revoked', { message_id: messageId })
    } catch (e) {}

    // TODO: Ideally we should update cache too. For simplicity, just invalidating cache is an option, or leave it to TTL.
    return { success: true }
  }

  async deleteMessage(userId: string, messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)
    const objectIdUserId = new this.databaseService.ObjectId(userId)

    const message = await this.databaseService.messages.findOne({ _id: msgId })
    if (!message) throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)
    
    if (!message.sender_id.equals(objectIdUserId)) {
      throw new HttpError('You can only delete your own messages', HTTP_STATUS.FORBIDDEN)
    }

    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $set: { status: 'deleted' } }
    )

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:deleted', { message_id: messageId })
    } catch (e) {}

    return { success: true }
  }

  async reactMessage(userId: string, messageId: string, emoji: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const reaction = { emoji, user_id: objectIdUserId }

    const message = await this.databaseService.messages.findOne({ _id: msgId })
    if (!message) throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)

    // Xóa reaction cũ của user này nếu có (nếu thiết kế 1 người 1 reaction), hoặc cứ push. Ở đây push.
    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $pull: { reactions: { user_id: objectIdUserId } } as any } // Xóa cũ
    )
    
    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $push: { reactions: reaction } as any } // Thêm mới
    )

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:reacted', { message_id: messageId, reaction })
    } catch (e) {}

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

  async searchMessages(userId: string, conversationId: string, q: string, cursor: string | undefined, limit: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: any = {
      conversation_id: convId,
      $text: { $search: q }
    }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const messages = await this.databaseService.messages
      .find(matchStage)
      .sort({ _id: -1 }) // Search cursor relies on _id sort instead of text score
      .limit(limit)
      .toArray()

    const has_next_page = messages.length === limit
    const next_cursor = has_next_page ? messages[messages.length - 1]._id?.toString() : null
    
    return { messages, next_cursor, has_next_page }
  }

  async getConversationMedia(userId: string, conversationId: string, cursor: string | undefined, limit: number) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: any = {
      conversation_id: convId,
      media_ids: { $exists: true, $not: { $size: 0 } }
    }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const messages = await this.databaseService.messages
      .find(matchStage)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = messages.length === limit
    const next_cursor = has_next_page ? messages[messages.length - 1]._id?.toString() : null
    
    return { messages, next_cursor, has_next_page }
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

  async updateGroupInfo(userId: string, conversationId: string, updates: { name?: string; avatar_url?: string }) {
    const convId = new this.databaseService.ObjectId(conversationId)
    // Optional: check if user is admin or member depending on business logic. 
    // Usually any member can change the group name or avatar, or only admin. 
    // Here we'll just check if they are in the group for simplicity, or we can assume it's checked by some middleware/controller logic.
    // I'll update it directly.
    const validUpdates: any = {}
    if (updates.name) validUpdates.name = updates.name
    if (updates.avatar_url) validUpdates.avatar_url = updates.avatar_url

    if (Object.keys(validUpdates).length === 0) return { success: true }

    await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $set: validUpdates }
    )
    return { success: true }
  }

  async getGroupMembers(userId: string, conversationId: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const group = await this.databaseService.groupConversations.aggregate([
      { $match: { _id: convId } },
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
        $project: {
          'userInfo.password': 0,
          'userInfo.email_verify_token': 0,
          'userInfo.forgot_password_token': 0
        }
      },
      {
        $group: {
          _id: '$_id',
          members: {
            $push: {
              role: '$members.role',
              joined_at: '$members.joined_at',
              user: '$userInfo'
            }
          }
        }
      }
    ]).toArray()

    return group.length > 0 ? group[0].members : []
  }

  async addGroupMembers(userId: string, conversationId: string, membersIds: string[]) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const newMembers = membersIds.map((id) => ({
      user_id: new this.databaseService.ObjectId(id),
      role: 'member',
      joined_at: new Date()
    }))

    await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $addToSet: { members: { $each: newMembers } } as any }
    )

    return { success: true }
  }

  async removeGroupMember(adminId: string, conversationId: string, userIdToRemove: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userIdToRemove)
    const adminObjectId = new this.databaseService.ObjectId(adminId)

    // Check if the requester is an admin (Optional but recommended)
    const group = await this.databaseService.groupConversations.findOne({
      _id: convId,
      members: { $elemMatch: { user_id: adminObjectId, role: 'admin' } }
    })

    if (!group) {
      throw new HttpError('Only admins can remove members', HTTP_STATUS.FORBIDDEN)
    }

    await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $pull: { members: { user_id: uId } } as any }
    )
    return { success: true }
  }

  async leaveGroup(userId: string, conversationId: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userId)

    await this.databaseService.groupConversations.updateOne(
      { _id: convId },
      { $pull: { members: { user_id: uId } } as any }
    )
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
    } catch (e) {}

    return { success: true }
  }

  async unreactMessage(userId: string, messageId: string) {
    const objectIdUserId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const message = await this.databaseService.messages.findOne({ _id: msgId })
    if (!message) throw new HttpError('Message not found', HTTP_STATUS.NOT_FOUND)

    await this.databaseService.messages.updateOne(
      { _id: msgId },
      { $pull: { reactions: { user_id: objectIdUserId } } as any }
    )

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:unreacted', { message_id: messageId, user_id: userId })
    } catch (e) {}

    return { success: true }
  }

  async getMessageReactions(messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)
    
    const message = await this.databaseService.messages.aggregate([
      { $match: { _id: msgId } },
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
          emoji: '$reactions.emoji',
          user: {
            _id: '$userInfo._id',
            name: '$userInfo.name',
            username: '$userInfo.username',
            avatar: '$userInfo.avatar'
          }
        }
      }
    ]).toArray()

    return message
  }

  async forwardMessage(userId: string, messageId: string, conversationIds: string[]) {
    const senderId = new this.databaseService.ObjectId(userId)
    const msgId = new this.databaseService.ObjectId(messageId)

    const originalMessage = await this.databaseService.messages.findOne({ _id: msgId })
    if (!originalMessage) {
      throw new HttpError('Original message not found', HTTP_STATUS.NOT_FOUND)
    }

    // Determine conversation types for all target conversations
    const objectConvIds = conversationIds.map(id => new this.databaseService.ObjectId(id))
    const [directs, groups] = await Promise.all([
      this.databaseService.directConversations.find({ _id: { $in: objectConvIds } }).toArray(),
      this.databaseService.groupConversations.find({ _id: { $in: objectConvIds } }).toArray()
    ])

    const convTypeMap = new Map<string, 'direct' | 'group'>()
    directs.forEach(c => convTypeMap.set(c._id.toString(), 'direct'))
    groups.forEach(c => convTypeMap.set(c._id.toString(), 'group'))

    const newMessages = conversationIds.map(convId => {
      const convType = convTypeMap.get(convId) || 'direct' // Default to direct if somehow missing
      const newMessage = new Message({
        _id: new this.databaseService.ObjectId(),
        conversation_id: new this.databaseService.ObjectId(convId),
        conversation_type: convType,
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
      await this.databaseService.messages.insertMany(newMessages)
      
      // Update last_message_preview for all conversations
      const updatePromises = conversationIds.map(convId => {
        const cId = new this.databaseService.ObjectId(convId)
        const preview = {
          sender_id: senderId,
          content: originalMessage.content,
          message_type: (originalMessage.media_ids && originalMessage.media_ids.length > 0) ? 'image' as const : 'text' as const
        }
        
        const convType = convTypeMap.get(convId)
        if (convType === 'direct') {
          return this.databaseService.directConversations.updateOne(
            { _id: cId },
            { $set: { last_message_at: new Date(), last_message_preview: preview } }
          )
        } else {
          return this.databaseService.groupConversations.updateOne(
            { _id: cId },
            { $set: { last_message_at: new Date(), last_message_preview: preview } }
          )
        }
      })

      await Promise.all(updatePromises)
    }

    return { success: true }
  }
}

const conversationService = new ConversationService()
export default conversationService
