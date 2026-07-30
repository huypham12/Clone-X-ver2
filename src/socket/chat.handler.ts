import { Server, Socket } from 'socket.io'
import { ObjectId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import conversationAccessService, {
  DIRECT_MESSAGE_BLOCKED_CODE
} from '~/modules/conversation/conversation-access.service'
import conversationMessageCommandService, {
  type ConversationMessageCommandService
} from '~/modules/conversation/conversation-message-command.service'
import conversationMessageDeliveryService, {
  type ConversationMessageDeliveryService
} from '~/modules/conversation/conversation-message-delivery.service'
import conversationReadService, { type ConversationReadService } from '~/modules/conversation/conversation-read.service'
import { REPLY_MESSAGE_UNAVAILABLE_CODE } from '~/modules/conversation/conversation-message-access.service'
import { envConfig } from '~/config/getEnvConfig'

interface ValidatedSendMessagePayload {
  conversation_id: string
  conversation_type: 'direct' | 'group'
  content?: string
  media_ids?: string[]
  reply_to_message_id?: string
  mention_user_ids?: string[]
  client_message_id?: string
}

interface ValidatedReadConversationPayload {
  conversation_id: string
  message_id?: string
}

interface ConversationSocketError {
  code: string
  message: string
  conversation_id?: string
}

type SendMessageAcknowledgement = (
  result: { success: true; message_id: string } | { success: false; error: ConversationSocketError }
) => void

type ReadConversationAcknowledgement = (
  result:
    | {
        success: true
        conversation_id: string
        unread_message_count: number
        unread_conversation_count: number
        total_unread_message_count: number
        version: number
      }
    | { success: false; error: ConversationSocketError }
) => void

const getDirectPartnerId = (currentUserId: string, memberIds: string[]) =>
  memberIds.find((memberId) => memberId !== currentUserId)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSendMessagePayload = (payload: unknown): payload is ValidatedSendMessagePayload =>
  isRecord(payload) &&
  typeof payload.conversation_id === 'string' &&
  ObjectId.isValid(payload.conversation_id) &&
  (payload.conversation_type === 'direct' || payload.conversation_type === 'group') &&
  (payload.content === undefined || typeof payload.content === 'string') &&
  (payload.media_ids === undefined ||
    (Array.isArray(payload.media_ids) &&
      payload.media_ids.every((id) => typeof id === 'string' && ObjectId.isValid(id)))) &&
  (payload.reply_to_message_id === undefined ||
    (typeof payload.reply_to_message_id === 'string' && ObjectId.isValid(payload.reply_to_message_id))) &&
  (payload.mention_user_ids === undefined ||
    (Array.isArray(payload.mention_user_ids) &&
      payload.mention_user_ids.length <= envConfig.conversation.maxGroupMembers &&
      payload.mention_user_ids.every((id) => typeof id === 'string' && ObjectId.isValid(id)))) &&
  (payload.client_message_id === undefined || typeof payload.client_message_id === 'string')

const isReadConversationPayload = (payload: unknown): payload is ValidatedReadConversationPayload =>
  isRecord(payload) &&
  typeof payload.conversation_id === 'string' &&
  ObjectId.isValid(payload.conversation_id) &&
  (payload.message_id === undefined || (typeof payload.message_id === 'string' && ObjectId.isValid(payload.message_id)))

const toSocketError = (error: unknown, conversationId?: string): ConversationSocketError => {
  if (error instanceof HttpError) {
    return {
      code: error.code ?? (error.statusCode === 403 ? 'CONVERSATION_ACCESS_DENIED' : 'MESSAGE_SEND_FAILED'),
      message: error.message,
      ...(conversationId ? { conversation_id: conversationId } : {})
    }
  }
  return {
    code: 'MESSAGE_SEND_FAILED',
    message: 'Internal server error while sending message',
    ...(conversationId ? { conversation_id: conversationId } : {})
  }
}

export const chatHandler = (
  io: Server,
  socket: Socket,
  commandService: ConversationMessageCommandService = conversationMessageCommandService,
  deliveryService: ConversationMessageDeliveryService = conversationMessageDeliveryService,
  readService: ConversationReadService = conversationReadService
) => {
  socket.on('@conversation:send', async (payload: unknown, rawAcknowledgement?: unknown) => {
    const acknowledge =
      typeof rawAcknowledgement === 'function' ? (rawAcknowledgement as SendMessageAcknowledgement) : undefined
    const conversationId =
      isRecord(payload) && typeof payload.conversation_id === 'string' ? payload.conversation_id : undefined

    try {
      if (!isSendMessagePayload(payload) || !socket.user_id) {
        const error = { code: 'INVALID_MESSAGE_PAYLOAD', message: 'Invalid payload' }
        acknowledge?.({ success: false, error })
        socket.emit('error', { message: error.message })
        return
      }

      const result = await commandService.send({
        sender_id: socket.user_id,
        conversation_id: payload.conversation_id,
        conversation_type: payload.conversation_type,
        content: payload.content,
        media_ids: payload.media_ids,
        reply_to_message_id: payload.reply_to_message_id,
        mention_user_ids: payload.mention_user_ids,
        client_message_id: payload.client_message_id
      })
      await deliveryService.deliver(result).catch((error: unknown) => {
        console.error('Could not deliver committed message:', error)
      })
      acknowledge?.({ success: true, message_id: result.message._id?.toHexString() ?? '' })
    } catch (error) {
      console.error('Error handling @conversation:send:', error)
      const socketError = toSocketError(error, conversationId)
      acknowledge?.({ success: false, error: socketError })
      if (socketError.code === DIRECT_MESSAGE_BLOCKED_CODE || socketError.code === REPLY_MESSAGE_UNAVAILABLE_CODE) {
        socket.emit('@conversation:error', socketError)
      } else {
        socket.emit('error', { message: socketError.message })
      }
    }
  })

  socket.on('@conversation:read', async (payload: unknown, rawAcknowledgement?: unknown) => {
    const acknowledge =
      typeof rawAcknowledgement === 'function' ? (rawAcknowledgement as ReadConversationAcknowledgement) : undefined
    const conversationId =
      isRecord(payload) && typeof payload.conversation_id === 'string' ? payload.conversation_id : undefined
    try {
      if (!isReadConversationPayload(payload) || !socket.user_id) {
        const error = { code: 'INVALID_READ_PAYLOAD', message: 'Invalid read payload' }
        acknowledge?.({ success: false, error })
        return
      }
      const result = await readService.markRead(socket.user_id, payload.conversation_id, payload.message_id)
      deliveryService.emitReadState(result)
      acknowledge?.({
        success: true,
        conversation_id: payload.conversation_id,
        unread_message_count: result.read_state.unread_message_count,
        unread_conversation_count: result.summary.unread_conversation_count,
        total_unread_message_count: result.summary.total_unread_message_count,
        version: result.summary.version
      })
    } catch (error) {
      const socketError = toSocketError(error, conversationId)
      acknowledge?.({ success: false, error: socketError })
      socket.emit('@conversation:error', socketError)
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
