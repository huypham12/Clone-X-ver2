import DatabaseService from '~/config/database.service'
import { Filter, ObjectId } from 'mongodb'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import redisService from '~/config/redis.service'
import { getIO } from '~/socket'
import { MediaStatus, MediaType } from '~/constants/enums'
import type User from '~/schemas/User.schema'
import conversationAccessService, { type ConversationType } from './conversation-access.service'
import type { MessageContextData, MessageWithMediaInfo } from './dto'

type ConversationPartner = Pick<User, '_id' | 'name' | 'username' | 'avatar'>
type DirectConversationAggregate = DirectConversation & {
  partner_id: ObjectId
  partnerInfo?: ConversationPartner
}

const MESSAGE_QUERY_MAX_TIME_MS = 10000

class ConversationService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
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

    // Normalize format
    const formattedDirects = directs.map((c) => ({
      ...c,
      type: 'direct',
      partner_info: c.partnerInfo
        ? {
            _id: c.partnerInfo._id,
            name: c.partnerInfo.name,
            username: c.partnerInfo.username,
            avatar: c.partnerInfo.avatar
          }
        : null,
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

    const conversation = await this.databaseService.directConversations.findOne({
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
      await this.databaseService.directConversations.updateOne({ _id: conversation._id }, { $set: { hidden_by: [] } })
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

  async getMessages(userId: string, conversationId: string, cursor: string | undefined, limit: number) {
    await conversationAccessService.assertConversationMember(userId, conversationId)

    const redisKey = `chat:messages:${conversationId}`
    const convId = new this.databaseService.ObjectId(conversationId)

    let messages: MessageWithMediaInfo[] = []

    if (!cursor) {
      const cachedMessages = await redisService.clientInstance.zRange(redisKey, 0, limit - 1, { REV: true })
      if (cachedMessages && cachedMessages.length === limit) {
        messages = cachedMessages.map((msg: string) => JSON.parse(msg) as MessageWithMediaInfo)
      }
    }

    if (messages.length === 0) {
      const matchStage: any = { conversation_id: convId }
      if (cursor) {
        matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
      }

      messages = await this.databaseService.messages
        .aggregate<MessageWithMediaInfo>([
          { $match: matchStage },
          { $sort: { _id: -1 } },
          { $limit: limit },
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

    const has_next_page = messages.length === limit
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
    await conversationAccessService.assertConversationMember(userId, conversationId)

    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const messageObjectId = new this.databaseService.ObjectId(messageId)
    const target = await this.databaseService.messages.findOne({
      _id: messageObjectId,
      conversation_id: conversationObjectId,
      status: 'sent'
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
      status: 'sent'
    }

    const [olderDescending, targetMessages, newerAscending] = await Promise.all([
      aggregateMessages({ ...baseMatch, _id: { $lt: messageObjectId } }, -1, before + 1),
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

    return {
      messages: [...olderMessages, ...targetMessages, ...newerMessages],
      target_message_id: messageId,
      older_cursor: hasOlderMessages ? (oldestIncludedMessage?._id?.toString() ?? null) : null,
      newer_cursor: hasNewerMessages ? (newestIncludedMessage?._id?.toString() ?? null) : null
    }
  }

  async markAsRead(userId: string, conversationId: string) {
    await conversationAccessService.assertConversationMember(userId, conversationId)

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

    await this.databaseService.messages.updateOne({ _id: msgId }, { $set: { status: 'revoked' } })

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:revoked', { message_id: messageId })
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

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

    await this.databaseService.messages.updateOne({ _id: msgId }, { $set: { status: 'deleted' } })

    try {
      getIO().to(message.conversation_id.toString()).emit('@message:deleted', { message_id: messageId })
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

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
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

    return { success: true }
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
    await conversationAccessService.assertConversationMember(userId, conversationId)

    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: Filter<Message> = {
      conversation_id: convId,
      status: 'sent',
      $text: { $search: q }
    }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const matchedMessages: MessageWithMediaInfo[] = await this.databaseService.messages
      .find(matchStage, { maxTimeMS: MESSAGE_QUERY_MAX_TIME_MS })
      .sort({ _id: -1 }) // Search cursor relies on _id sort instead of text score
      .limit(limit + 1)
      .toArray()

    const has_next_page = matchedMessages.length > limit
    const messages = matchedMessages.slice(0, limit)
    const next_cursor = has_next_page ? (messages[messages.length - 1]?._id?.toString() ?? null) : null

    return { messages, next_cursor, has_next_page }
  }

  async getConversationMedia(userId: string, conversationId: string, cursor: string | undefined, limit: number) {
    await conversationAccessService.assertConversationMember(userId, conversationId)

    const convId = new this.databaseService.ObjectId(conversationId)
    const matchStage: Filter<Message> = {
      conversation_id: convId,
      status: 'sent',
      media_ids: { $exists: true, $not: { $size: 0 } }
    }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

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
    const pageMessages = messages.slice(0, limit)
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

    if (access.type === 'direct') {
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: uId }, { user2_id: uId }] },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
      await this.databaseService.directConversations.updateOne(
        { _id: convId, $or: [{ user1_id: uId }, { user2_id: uId }] },
        { $push: { muted_by: muteObj } as any }
      )
    } else {
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': uId },
        { $pull: { muted_by: { user_id: uId } } as any }
      )
      await this.databaseService.groupConversations.updateOne(
        { _id: convId, 'members.user_id': uId },
        { $push: { muted_by: muteObj } as any }
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
    await conversationAccessService.assertConversationMember(userId, conversationId, 'group')

    const validUpdates: any = {}
    if (updates.name) validUpdates.name = updates.name
    if (updates.avatar_url) validUpdates.avatar_url = updates.avatar_url

    if (Object.keys(validUpdates).length === 0) return { success: true }

    await this.databaseService.groupConversations.updateOne(
      { _id: convId, 'members.user_id': userObjectId },
      { $set: validUpdates }
    )
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
      ])
      .toArray()

    return group.length > 0 ? group[0].members : []
  }

  async addGroupMembers(userId: string, conversationId: string, membersIds: string[]) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const userObjectId = new this.databaseService.ObjectId(userId)
    await conversationAccessService.assertConversationMember(userId, conversationId, 'group')

    const newMembers = membersIds.map((id) => ({
      user_id: new this.databaseService.ObjectId(id),
      role: 'member',
      joined_at: new Date()
    }))

    await this.databaseService.groupConversations.updateOne(
      { _id: convId, 'members.user_id': userObjectId },
      { $addToSet: { members: { $each: newMembers } } as any }
    )

    return { success: true }
  }

  async removeGroupMember(adminId: string, conversationId: string, userIdToRemove: string) {
    const convId = new this.databaseService.ObjectId(conversationId)
    const uId = new this.databaseService.ObjectId(userIdToRemove)
    const adminObjectId = new this.databaseService.ObjectId(adminId)
    await conversationAccessService.assertConversationMember(adminId, conversationId, 'group')

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
    await conversationAccessService.assertConversationMember(userId, conversationId, 'group')

    await this.databaseService.groupConversations.updateOne(
      { _id: convId, 'members.user_id': uId },
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
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

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
      getIO()
        .to(message.conversation_id.toString())
        .emit('@message:unreacted', { message_id: messageId, user_id: userId })
    } catch {
      // Socket server can be unavailable while the service is exercised in isolation.
    }

    return { success: true }
  }

  async getMessageReactions(messageId: string) {
    const msgId = new this.databaseService.ObjectId(messageId)

    const message = await this.databaseService.messages
      .aggregate([
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
      ])
      .toArray()

    return message
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

    const normalizedConversationIds = conversationIds.map((conversationId) =>
      new this.databaseService.ObjectId(conversationId).toString()
    )
    const targetConversations = await Promise.all(
      normalizedConversationIds.map((conversationId) =>
        conversationAccessService.assertConversationMember(userId, conversationId)
      )
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
      await this.databaseService.messages.insertMany(newMessages)

      // Update last_message_preview for all conversations
      const updatePromises = normalizedConversationIds.map((conversationId) => {
        const conversationObjectId = new this.databaseService.ObjectId(conversationId)
        const preview = {
          sender_id: senderId,
          content: originalMessage.content,
          message_type: forwardedMessageType
        }

        if (targetConversationTypeById.get(conversationId) === 'direct') {
          return this.databaseService.directConversations.updateOne(
            { _id: conversationObjectId, $or: [{ user1_id: senderId }, { user2_id: senderId }] },
            { $set: { last_message_at: new Date(), last_message_preview: preview } }
          )
        }

        return this.databaseService.groupConversations.updateOne(
          { _id: conversationObjectId, 'members.user_id': senderId },
          { $set: { last_message_at: new Date(), last_message_preview: preview } }
        )
      })

      await Promise.all(updatePromises)
    }

    return { success: true }
  }
}

const conversationService = new ConversationService()
export default conversationService
