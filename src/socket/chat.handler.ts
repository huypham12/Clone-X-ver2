import { Server, Socket } from 'socket.io'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import Message from '~/schemas/Message.schema'
import MediaMetadata from '~/schemas/MediaMetadata.schema'
import notificationService from '../modules/notification/notification.service'
import { MediaStatus, MediaType, NotificationType } from '~/constants/enums'
import { ObjectId } from 'mongodb'

type ConversationType = 'direct' | 'group'
type MessageMediaType = MediaType.Image | MediaType.Video | MediaType.Audio
type MessagePreviewType = 'text' | MessageMediaType

interface SendMessagePayload {
  conversation_id?: unknown
  conversation_type?: unknown
  content?: unknown
  media_ids?: unknown
  reply_to_message_id?: unknown
}

const isMessageMediaType = (type: MediaType): type is MessageMediaType =>
  type === MediaType.Image || type === MediaType.Video || type === MediaType.Audio

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

  socket.on('@conversation:send', async (payload: SendMessagePayload) => {
    try {
      const { conversation_id, conversation_type, content, media_ids, reply_to_message_id } = payload

      const hasValidConversation =
        typeof conversation_id === 'string' &&
        ObjectId.isValid(conversation_id) &&
        (conversation_type === 'direct' || conversation_type === 'group')
      const hasValidContent = content === undefined || typeof content === 'string'
      const hasValidMediaIds =
        media_ids === undefined ||
        (Array.isArray(media_ids) && media_ids.every((id) => typeof id === 'string' && ObjectId.isValid(id)))
      const hasValidReplyId =
        reply_to_message_id === undefined ||
        (typeof reply_to_message_id === 'string' && ObjectId.isValid(reply_to_message_id))

      if (!hasValidConversation || !hasValidContent || !hasValidMediaIds || !hasValidReplyId) {
        return socket.emit('error', { message: 'Invalid payload' })
      }

      const normalizedContent = typeof content === 'string' ? content.trim() : ''
      const normalizedMediaIds = Array.isArray(media_ids) ? (media_ids as string[]) : []
      const uniqueMediaIds = [...new Set(normalizedMediaIds)]

      if (
        (!normalizedContent && uniqueMediaIds.length === 0) ||
        uniqueMediaIds.length !== normalizedMediaIds.length ||
        uniqueMediaIds.length > 4
      ) {
        return socket.emit('error', { message: 'A message must contain text or up to 4 unique media files' })
      }

      const sender_id = new databaseService.ObjectId(socket.user_id as string)
      const convObjectId = new databaseService.ObjectId(conversation_id as string)
      const typedConversationType = conversation_type as ConversationType
      const memberIds = await getConversationMembers(conversation_id as string, typedConversationType)

      if (!memberIds.includes(sender_id.toString())) {
        return socket.emit('error', { message: 'You are not a member of this conversation' })
      }

      const mediaObjectIds = uniqueMediaIds.map((id) => new databaseService.ObjectId(id))
      const medias_info: MediaMetadata[] = []

      if (mediaObjectIds.length > 0) {
        const mediaDocuments = await databaseService.medias.find({ _id: { $in: mediaObjectIds } }).toArray()
        const mediaById = new Map(mediaDocuments.map((media) => [media._id.toString(), media]))

        for (const mediaId of uniqueMediaIds) {
          const media = mediaById.get(mediaId)
          const isOwnedBySender = media?.uploaded_by?.toString() === sender_id.toString()
          const isReady = media?.status === MediaStatus.Ready && Boolean(media.url)
          const isSupported = media ? isMessageMediaType(media.type) : false

          if (!media || !isOwnedBySender || !isReady || !isSupported) {
            return socket.emit('error', { message: 'One or more media files are invalid or not ready' })
          }

          medias_info.push(media)
        }
      }

      const newMessage = new Message({
        _id: new databaseService.ObjectId(),
        conversation_id: convObjectId,
        conversation_type: typedConversationType,
        sender_id,
        content: normalizedContent,
        media_ids: mediaObjectIds,
        send_at: new Date(),
        read_by: [sender_id],
        reply_to_message_id:
          typeof reply_to_message_id === 'string' ? new databaseService.ObjectId(reply_to_message_id) : undefined,
        status: 'sent',
        reactions: []
      })

      // 1. Save to MongoDB
      await databaseService.messages.insertOne(newMessage)

      const messageToBroadcast = {
        ...newMessage,
        medias_info
      }

      const firstMediaType = medias_info[0]?.type
      const messageType: MessagePreviewType =
        firstMediaType && isMessageMediaType(firstMediaType) ? firstMediaType : 'text'
      const messagePreview = {
        sender_id,
        content: normalizedContent.substring(0, 50),
        message_type: messageType
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
      if (memberIds.length > 0) {
        io.to(memberIds).emit('@conversation:receive', messageToBroadcast)
      }

      // 5. Gửi Notification cho những người trong nhóm
      const conv = typedConversationType === 'direct'
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
