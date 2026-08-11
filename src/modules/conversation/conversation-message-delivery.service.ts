import redisService from '~/config/redis.service'
import { getIO } from '~/socket'
import type { HydratedMessage } from './dto'
import conversationMessageHydrationService from './conversation-message-hydration.service'
import { getConversationHistoryCutoff } from './conversation-access.service'
import type { MessageCommandResult } from './conversation-message-command.service'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'

export class ConversationMessageDeliveryService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async deliver(result: MessageCommandResult): Promise<HydratedMessage | null> {
    if (!result.created) return null
    const messageWithMedia = { ...result.message, medias_info: result.medias_info }
    const hydrated = await conversationMessageHydrationService.hydrateSingleMessage(messageWithMedia)
    await this.cache(
      result.message.conversation_id.toHexString(),
      hydrated,
      result.message.send_at?.getTime() ?? Date.now()
    )

    const directConversation =
      result.message.conversation_type === 'direct'
        ? await this.databaseService.directConversations.findOne({ _id: result.message.conversation_id })
        : null
    const groupConversation =
      result.message.conversation_type === 'group'
        ? await this.databaseService.groupConversations.findOne({ _id: result.message.conversation_id })
        : null
    const conversation = directConversation ?? groupConversation
    if (!conversation) return hydrated
    const currentMemberIds: string[] = directConversation
      ? [directConversation.user1_id.toHexString(), directConversation.user2_id.toHexString()]
      : (groupConversation?.members.map((member) => member.user_id.toHexString()) ?? [])
    const personalizedIds = new Set(
      conversation.history_cleared_by?.map((marker) => marker.user_id.toHexString()) ?? []
    )
    const sharedRecipientIds = currentMemberIds.filter((id) => !personalizedIds.has(id))
    try {
      if (sharedRecipientIds.length > 0) getIO().to(sharedRecipientIds).emit('@conversation:receive', hydrated)
      await Promise.all(
        currentMemberIds
          .filter((id) => personalizedIds.has(id))
          .map(async (recipientId) => {
            const personalized = await conversationMessageHydrationService.hydrateSingleMessage(
              messageWithMedia,
              recipientId,
              getConversationHistoryCutoff(conversation, recipientId)
            )
            getIO().to(recipientId).emit('@conversation:receive', personalized)
          })
      )
      for (const mutation of result.read_mutations) {
        const payload = {
          conversation_id: mutation.read_state.conversation_id.toHexString(),
          last_read_message_id: mutation.read_state.last_read_message_id?.toHexString() ?? null,
          last_read_at: mutation.read_state.last_read_at?.toISOString() ?? null,
          unread_message_count: mutation.read_state.unread_message_count,
          unread_conversation_count: mutation.summary.unread_conversation_count,
          total_unread_message_count: mutation.summary.total_unread_message_count,
          version: mutation.summary.version,
          updated_at: mutation.summary.updated_at.toISOString()
        }
        getIO().to(mutation.read_state.user_id.toHexString()).emit('@conversation:read-state', payload)
      }
    } catch (error) {
      console.error('Could not emit committed message:', error)
    }

    return hydrated
  }

  emitReadState(result: import('./conversation-read.service').ConversationReadMutationResult): void {
    const payload = {
      conversation_id: result.read_state.conversation_id.toHexString(),
      last_read_message_id: result.read_state.last_read_message_id?.toHexString() ?? null,
      last_read_at: result.read_state.last_read_at?.toISOString() ?? null,
      unread_message_count: result.read_state.unread_message_count,
      unread_conversation_count: result.summary.unread_conversation_count,
      total_unread_message_count: result.summary.total_unread_message_count,
      version: result.summary.version,
      updated_at: result.summary.updated_at.toISOString()
    }
    try {
      getIO().to(result.read_state.user_id.toHexString()).emit('@conversation:read-state', payload)
    } catch (error) {
      console.error('Could not emit @conversation:read-state:', error)
    }
  }

  private async cache(conversationId: string, message: HydratedMessage, score: number): Promise<void> {
    if (envConfig.conversation.messageCacheMode === 'off') return

    try {
      const key = `chat:messages:${conversationId}`
      await redisService.clientInstance.zAdd(key, { score, value: JSON.stringify(message) })
      await redisService.clientInstance.zRemRangeByRank(key, 0, -101)
      await redisService.clientInstance.expire(key, 7 * 24 * 60 * 60)
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      console.error(`Could not cache committed message (${errorName})`)
    }
  }
}

const conversationMessageDeliveryService = new ConversationMessageDeliveryService()
export default conversationMessageDeliveryService
