import { Server, Socket } from 'socket.io'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import Message from '~/schemas/Message.schema'
import MediaMetadata from '~/schemas/MediaMetadata.schema'
import notificationService from '../modules/notification/notification.service'
import { MediaStatus, MediaType, NotificationType } from '~/constants/enums'
import { ObjectId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import conversationAccessService, {
  DIRECT_MESSAGE_BLOCKED_CODE,
  DIRECT_MESSAGE_BLOCKED_MESSAGE
} from '~/modules/conversation/conversation-access.service'
import conversationMessageHydrationService from '~/modules/conversation/conversation-message-hydration.service'
import conversationMessageAccessService, {
  REPLY_MESSAGE_UNAVAILABLE_CODE,
  REPLY_MESSAGE_UNAVAILABLE_MESSAGE
} from '~/modules/conversation/conversation-message-access.service'

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

interface ConversationSendError {
  code: string
  message: string
  conversation_id?: string
}

type SendMessageAcknowledgement = (
  result: { success: true; message_id: string } | { success: false; error: ConversationSendError }
) => void

const isMessageMediaType = (type: MediaType): type is MessageMediaType =>
  type === MediaType.Image || type === MediaType.Video || type === MediaType.Audio

const getDirectPartnerId = (currentUserId: string, memberIds: string[]) =>
  memberIds.find((memberId) => memberId !== currentUserId)

export const chatHandler = (io: Server, socket: Socket) => {
  const databaseService = new DatabaseService()

  socket.on('@conversation:send', async (payload: SendMessagePayload, rawAcknowledgement?: unknown) => {
    const acknowledge =
      typeof rawAcknowledgement === 'function'
        ? (rawAcknowledgement as SendMessageAcknowledgement)
        : undefined
    const rejectSend = (code: string, message: string, conversationId?: string) => {
      const error: ConversationSendError = {
        code,
        message,
        ...(conversationId ? { conversation_id: conversationId } : {})
      }
      acknowledge?.({ success: false, error })
      return error
    }

    try {
      const { conversation_id, conversation_type, content, media_ids, reply_to_message_id } = payload
      const acknowledgementConversationId =
        typeof conversation_id === 'string' ? conversation_id : undefined

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
        rejectSend('INVALID_MESSAGE_PAYLOAD', 'Invalid payload')
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
        rejectSend(
          'INVALID_MESSAGE_CONTENT',
          'A message must contain text or up to 4 unique media files',
          acknowledgementConversationId
        )
        return socket.emit('error', { message: 'A message must contain text or up to 4 unique media files' })
      }

      const sender_id = new databaseService.ObjectId(socket.user_id as string)
      const convObjectId = new databaseService.ObjectId(conversation_id as string)
      const typedConversationType = conversation_type as ConversationType
      let memberIds: string[]

      try {
        const access = await conversationAccessService.assertConversationMember(
          sender_id.toString(),
          conversation_id as string,
          typedConversationType
        )
        memberIds = access.memberIds

        if (access.type === 'direct') {
          const partnerId = getDirectPartnerId(sender_id.toString(), memberIds)
          const isBlocked =
            !partnerId ||
            (await conversationAccessService.isDirectMessagingBlocked(sender_id.toString(), partnerId))

          if (isBlocked) {
            return socket.emit(
              '@conversation:error',
              rejectSend(DIRECT_MESSAGE_BLOCKED_CODE, DIRECT_MESSAGE_BLOCKED_MESSAGE, conversation_id as string)
            )
          }
        }
      } catch {
        rejectSend(
          'CONVERSATION_ACCESS_DENIED',
          'Conversation not found or access denied',
          acknowledgementConversationId
        )
        return socket.emit('error', { message: 'Conversation not found or access denied' })
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
            rejectSend(
              'INVALID_MESSAGE_MEDIA',
              'One or more media files are invalid or not ready',
              conversation_id as string
            )
            return socket.emit('error', { message: 'One or more media files are invalid or not ready' })
          }

          medias_info.push(media)
        }
      }

      if (typedConversationType === 'group') {
        try {
          const refreshedAccess = await conversationAccessService.assertConversationMember(
            sender_id.toString(),
            conversation_id as string,
            'group'
          )
          memberIds = refreshedAccess.memberIds
        } catch {
          rejectSend(
            'CONVERSATION_ACCESS_DENIED',
            'You are no longer a member of this group',
            conversation_id as string
          )
          return socket.emit('error', { message: 'You are no longer a member of this group' })
        }
      }

      if (typeof reply_to_message_id === 'string') {
        try {
          await conversationMessageAccessService.assertReplyTargetAccess(
            sender_id.toString(),
            reply_to_message_id,
            conversation_id as string,
            typedConversationType
          )
        } catch (error) {
          if (!(error instanceof HttpError) || error.code !== REPLY_MESSAGE_UNAVAILABLE_CODE) {
            throw error
          }

          return socket.emit(
            '@conversation:error',
            rejectSend(
              REPLY_MESSAGE_UNAVAILABLE_CODE,
              REPLY_MESSAGE_UNAVAILABLE_MESSAGE,
              conversation_id as string
            )
          )
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

      const messageToBroadcast = await conversationMessageHydrationService.hydrateSingleMessage({
        ...newMessage,
        medias_info
      })

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
      if (typedConversationType === 'group') {
        const currentGroup = await databaseService.groupConversations.findOne(
          { _id: convObjectId },
          { projection: { members: 1 } }
        )
        memberIds = currentGroup?.members.map((member) => member.user_id.toString()) ?? []
      }

      if (memberIds.length > 0) {
        io.to(memberIds).emit('@conversation:receive', messageToBroadcast)
      }

      acknowledge?.({ success: true, message_id: newMessage._id?.toString() ?? '' })

      // 5. Gửi Notification cho những người trong nhóm
      try {
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
        console.error('Could not create message notifications:', error)
      }
      
    } catch (error) {
      console.error('Error handling @conversation:send:', error)
      rejectSend(
        'MESSAGE_SEND_FAILED',
        'Internal server error while sending message',
        typeof payload.conversation_id === 'string' ? payload.conversation_id : undefined
      )
      socket.emit('error', { message: 'Internal server error while sending message' })
    }
  })

  socket.on('@conversation:typing_on', async (payload) => {
    const { conversation_id, conversation_type } = payload
    const isValidPayload =
      typeof conversation_id === 'string' &&
      ObjectId.isValid(conversation_id) &&
      (conversation_type === 'direct' || conversation_type === 'group')

    if (!isValidPayload || !socket.user_id) return

    try {
      const access = await conversationAccessService.assertConversationMember(
        socket.user_id,
        conversation_id,
        conversation_type
      )

      if (access.type === 'direct') {
        const partnerId = getDirectPartnerId(socket.user_id, access.memberIds)
        if (!partnerId || (await conversationAccessService.isDirectMessagingBlocked(socket.user_id, partnerId))) {
          return
        }
      }

      const receivers = access.memberIds.filter((id) => id !== socket.user_id)
      if (receivers.length === 0) return

      io.to(receivers).emit('@conversation:typing_on', {
        conversation_id,
        user_id: socket.user_id
      })
    } catch {
      socket.emit('error', { message: 'Conversation not found or access denied' })
    }
  })

  socket.on('@conversation:typing_off', async (payload) => {
    const { conversation_id, conversation_type } = payload
    const isValidPayload =
      typeof conversation_id === 'string' &&
      ObjectId.isValid(conversation_id) &&
      (conversation_type === 'direct' || conversation_type === 'group')

    if (!isValidPayload || !socket.user_id) return

    try {
      const access = await conversationAccessService.assertConversationMember(
        socket.user_id,
        conversation_id,
        conversation_type
      )

      if (access.type === 'direct') {
        const partnerId = getDirectPartnerId(socket.user_id, access.memberIds)
        if (!partnerId || (await conversationAccessService.isDirectMessagingBlocked(socket.user_id, partnerId))) {
          return
        }
      }

      const receivers = access.memberIds.filter((id) => id !== socket.user_id)
      if (receivers.length === 0) return

      io.to(receivers).emit('@conversation:typing_off', {
        conversation_id,
        user_id: socket.user_id
      })
    } catch {
      socket.emit('error', { message: 'Conversation not found or access denied' })
    }
  })
}
