import redisService from '~/config/redis.service'
import { getIO } from '~/socket'
import type { MessageRevokedEvent } from './dto'

type MessageActionEventName = '@message:revoked' | '@message:deleted' | '@message:reacted' | '@message:unreacted'

type MessageActionEventPayload = MessageRevokedEvent | Record<string, unknown>
type MessageSocketServer = Pick<ReturnType<typeof getIO>, 'to'>
type DeleteMessageCache = (key: string) => Promise<unknown>

export class ConversationMessageSyncService {
  private readonly deleteMessageCache: DeleteMessageCache
  private readonly getSocketServer: () => MessageSocketServer

  constructor(
    deleteMessageCache: DeleteMessageCache = (key) => redisService.del(key),
    getSocketServer: () => MessageSocketServer = getIO
  ) {
    this.deleteMessageCache = deleteMessageCache
    this.getSocketServer = getSocketServer
  }

  async invalidateMessageCache(conversationId: string): Promise<void> {
    try {
      await this.deleteMessageCache(`chat:messages:${conversationId}`)
    } catch (error) {
      console.error('Could not invalidate conversation message cache:', error)
    }
  }

  private emitToPersonalRooms(
    recipientIds: string[],
    eventName: MessageActionEventName,
    payload: MessageActionEventPayload
  ): void {
    const uniqueRecipientIds = [...new Set(recipientIds)]
    if (uniqueRecipientIds.length === 0) return

    try {
      this.getSocketServer().to(uniqueRecipientIds).emit(eventName, payload)
    } catch (error) {
      console.error(`Could not emit ${eventName}:`, error)
    }
  }

  async syncConversationAction(
    conversationId: string,
    recipientIds: string[],
    eventName: MessageActionEventName,
    payload: MessageActionEventPayload
  ): Promise<void> {
    await this.invalidateMessageCache(conversationId)
    this.emitToPersonalRooms(recipientIds, eventName, payload)
  }

  async syncActorAction(
    conversationId: string,
    actorId: string,
    eventName: MessageActionEventName,
    payload: MessageActionEventPayload
  ): Promise<void> {
    await this.invalidateMessageCache(conversationId)
    this.emitToPersonalRooms([actorId], eventName, payload)
  }
}

const conversationMessageSyncService = new ConversationMessageSyncService()

export default conversationMessageSyncService
