import { Server, Socket } from 'socket.io'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import Message from '~/schemas/Message.schema'
import notificationService from '../modules/notification/notification.service'
import { NotificationType } from '~/constants/enums'

export const chatHandler = (io: Server, socket: Socket) => {
  const databaseService = new DatabaseService()

  // Hàm tiện ích lấy thành viên conversation (có cache Redis)
  const getConversationMembers = async (conversation_id: string, conversation_type: string) => {
    const cacheKey = `conv_members:${conversation_id}`
    const cached = await redisService.get(cacheKey)
    if (cached) return cached as string[]

    const convObjectId = new databaseService.ObjectId(conversation_id)
    const conv = conversation_type === 'direct' 
      ? await databaseService.directConversations.findOne({ _id: convObjectId })
      : await databaseService.groupConversations.findOne({ _id: convObjectId })

    if (!conv) return []

    let memberIds: string[] = []
    if (conversation_type === 'direct') {
      memberIds = [(conv as any).user1_id.toString(), (conv as any).user2_id.toString()]
    } else {
      memberIds = (conv as any).members.map((m: any) => m.user_id.toString())
    }

    await redisService.set(cacheKey, memberIds, 3600 * 24) // Cache 24h
    return memberIds
  }

  socket.on('@conversation:send', async (payload) => {
    try {
      const { conversation_id, conversation_type, content, media_ids, reply_to_message_id } = payload

      if (!conversation_id || !content) {
        return socket.emit('error', { message: 'Invalid payload' })
      }

      const sender_id = new databaseService.ObjectId(socket.user_id as string)
      const convObjectId = new databaseService.ObjectId(conversation_id)
      
      const newMessage = new Message({
        _id: new databaseService.ObjectId(),
        conversation_id: convObjectId,
        conversation_type,
        sender_id,
        content,
        media_ids: media_ids?.map((id: string) => new databaseService.ObjectId(id)) || [],
        send_at: new Date(),
        read_by: [sender_id],
        reply_to_message_id: reply_to_message_id ? new databaseService.ObjectId(reply_to_message_id) : undefined,
        status: 'sent',
        reactions: []
      })

      // 1. Save to MongoDB
      await databaseService.messages.insertOne(newMessage)

      // Fetch medias_info if there are media_ids
      let medias_info = []
      if (media_ids && media_ids.length > 0) {
        medias_info = await databaseService.medias.find({
          _id: { $in: media_ids.map((id: string) => new databaseService.ObjectId(id)) }
        }).toArray()
      }

      const messageToBroadcast = {
        ...newMessage,
        medias_info
      }

      const messagePreview = {
        sender_id,
        content: content.substring(0, 50),
        message_type: media_ids && media_ids.length > 0 ? 'image' : 'text'
      }

      // 2. Update Conversations last_message
      const updateQuery = {
        $set: {
          last_message_at: newMessage.send_at,
          last_message_preview: messagePreview as any,
          updated_at: new Date()
        }
      }
      if (conversation_type === 'direct') {
        await databaseService.directConversations.updateOne({ _id: convObjectId }, updateQuery)
      } else if (conversation_type === 'group') {
        await databaseService.groupConversations.updateOne({ _id: convObjectId }, updateQuery)
      }

      // 3. Cache to Redis using ZADD
      const redisKey = `chat:messages:${conversation_id}`
      const score = newMessage.send_at?.getTime() || Date.now()
      
      await redisService.clientInstance.zAdd(redisKey, {
        score,
        value: JSON.stringify(messageToBroadcast)
      })
      await redisService.clientInstance.zRemRangeByRank(redisKey, 0, -101)
      await redisService.clientInstance.expire(redisKey, 7 * 24 * 60 * 60)

      // 4. Lấy danh sách members và Broadcast qua Personal Inbox
      const memberIds = await getConversationMembers(conversation_id, conversation_type)
      if (memberIds.length > 0) {
        io.to(memberIds).emit('@conversation:receive', messageToBroadcast)
      }

      // 5. Gửi Notification cho những người trong nhóm
      const conv = conversation_type === 'direct' 
        ? await databaseService.directConversations.findOne({ _id: convObjectId })
        : await databaseService.groupConversations.findOne({ _id: convObjectId })
      
      if (conv) {
        const mutedMap: Record<string, boolean> = {}
        if (conv.muted_by) {
          const now = new Date()
          conv.muted_by.forEach(mute => {
            if (!mute.until || mute.until > now) {
              mutedMap[mute.user_id.toString()] = true
            }
          })
        }

        for (const mId of memberIds) {
          if (mId !== sender_id.toString() && !mutedMap[mId]) {
            await notificationService.createNotification(
              mId,
              sender_id.toString(),
              NotificationType.Message,
              conversation_id
            )
          }
        }
      }
      
    } catch (error) {
      console.error('Error handling @conversation:send:', error)
      socket.emit('error', { message: 'Internal server error while sending message' })
    }
  })

  socket.on('@conversation:typing_on', async (payload) => {
    const { conversation_id, conversation_type } = payload
    if (conversation_id && conversation_type) {
      const memberIds = await getConversationMembers(conversation_id, conversation_type)
      // Bỏ chính người gửi ra khỏi danh sách nhận
      const receivers = memberIds.filter(id => id !== socket.user_id)
      if (receivers.length > 0) {
        io.to(receivers).emit('@conversation:typing_on', {
          conversation_id,
          user_id: socket.user_id
        })
      }
    }
  })

  socket.on('@conversation:typing_off', async (payload) => {
    const { conversation_id, conversation_type } = payload
    if (conversation_id && conversation_type) {
      const memberIds = await getConversationMembers(conversation_id, conversation_type)
      const receivers = memberIds.filter(id => id !== socket.user_id)
      if (receivers.length > 0) {
        io.to(receivers).emit('@conversation:typing_off', {
          conversation_id,
          user_id: socket.user_id
        })
      }
    }
  })
}
