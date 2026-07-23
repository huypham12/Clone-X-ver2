import { Server, Socket } from 'socket.io'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import Message from '~/schemas/Message.schema'
import notificationService from '../modules/notification/notification.service'
import { NotificationType } from '~/constants/enums'

export const chatHandler = (io: Server, socket: Socket) => {
  const databaseService = new DatabaseService()

  socket.on('@conversation:send', async (payload) => {
    try {
      const { conversation_id, conversation_type, content, media_ids, reply_to_message_id } = payload

      // Basic validation
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
        read_by: [sender_id], // Sender has read their own message
        reply_to_message_id: reply_to_message_id ? new databaseService.ObjectId(reply_to_message_id) : undefined,
        status: 'sent',
        reactions: []
      })

      // 1. Save to MongoDB (Messages table)
      await databaseService.messages.insertOne(newMessage)

      const messagePreview = {
        sender_id,
        content: content.substring(0, 50),
        message_type: media_ids && media_ids.length > 0 ? 'image' : 'text'
      }

      // 2. Update Conversations last_message
      if (conversation_type === 'direct') {
        await databaseService.directConversations.updateOne(
          { _id: convObjectId },
          {
            $set: {
              last_message_at: newMessage.send_at,
              last_message_preview: messagePreview as any,
              updated_at: new Date()
            }
          }
        )
      } else if (conversation_type === 'group') {
        await databaseService.groupConversations.updateOne(
          { _id: convObjectId },
          {
            $set: {
              last_message_at: newMessage.send_at,
              last_message_preview: messagePreview as any,
              updated_at: new Date()
            }
          }
        )
      }

      // 3. Cache to Redis using ZADD (score is timestamp)
      const redisKey = `chat:messages:${conversation_id}`
      const score = newMessage.send_at?.getTime() || Date.now()
      
      await redisService.clientInstance.zAdd(redisKey, {
        score,
        value: JSON.stringify(newMessage)
      })
      
      // Giữ lại 100 tin nhắn gần nhất trong cache, xoá bớt các tin cũ để đỡ tốn RAM
      await redisService.clientInstance.zRemRangeByRank(redisKey, 0, -101)
      await redisService.clientInstance.expire(redisKey, 7 * 24 * 60 * 60)

      // 4. Broadcast the message to all users in the conversation room
      io.to(conversation_id).emit('@conversation:receive', newMessage)

      // 5. Gửi Notification cho những người trong nhóm (nếu họ không Mute)
      const conv = conversation_type === 'direct' 
        ? await databaseService.directConversations.findOne({ _id: convObjectId })
        : await databaseService.groupConversations.findOne({ _id: convObjectId })
      
      if (conv) {
        let memberIds: string[] = []
        if (conversation_type === 'direct') {
          memberIds = [(conv as any).user1_id.toString(), (conv as any).user2_id.toString()]
        } else {
          memberIds = (conv as any).members.map((m: any) => m.user_id.toString())
        }

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
}
