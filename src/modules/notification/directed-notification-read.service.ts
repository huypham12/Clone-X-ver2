import type { ClientSession, ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationTargetType, NotificationType } from '~/constants/enums'
import type { CreateNotificationCommand } from './notification.type'
import type { NotificationMutationResult } from './notification-event.type'
import { NotificationDeliveryService } from './notification-delivery.service'
import { NotificationRepository } from './notification.repository'

const INVALIDATION_PAGE_SIZE = 500
const DIRECTED_MESSAGE_TYPES = [NotificationType.MessageReply, NotificationType.MessageMention]

export class DirectedNotificationReadService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly repository: NotificationRepository = new NotificationRepository(databaseService),
    private readonly deliveryService: NotificationDeliveryService = new NotificationDeliveryService()
  ) {}

  async retainCommandsAfterReadPosition(
    commands: CreateNotificationCommand[],
    conversationId: ObjectId,
    messageId: ObjectId,
    session: ClientSession
  ): Promise<CreateNotificationCommand[]> {
    if (commands.length === 0) return []
    if (!session.inTransaction()) {
      throw new Error('Directed notification relevance check requires an active transaction')
    }

    const recipientIds = [
      ...new Map(commands.map((command) => [command.recipient_id.toHexString(), command.recipient_id])).values()
    ]

    // Both message-notification creation and conversation read update this document.
    // The write creates a MongoDB transaction conflict when they race, so withTransaction
    // retries against the newly committed read position instead of persisting a stale item.
    await this.databaseService.conversationReadStates.bulkWrite(
      recipientIds.map((recipientId) => ({
        updateOne: {
          filter: { conversation_id: conversationId, user_id: recipientId },
          update: { $inc: { notification_relevance_version: 1 } }
        }
      })),
      { session, ordered: false }
    )

    const alreadyReadStates = await this.databaseService.conversationReadStates
      .find(
        {
          conversation_id: conversationId,
          user_id: { $in: recipientIds },
          last_read_message_id: { $gte: messageId }
        },
        { projection: { user_id: 1 }, session }
      )
      .toArray()
    const alreadyReadRecipientIds = new Set(alreadyReadStates.map((state) => state.user_id.toHexString()))
    return commands.filter((command) => !alreadyReadRecipientIds.has(command.recipient_id.toHexString()))
  }

  async invalidateThroughReadPosition(
    recipientId: ObjectId,
    conversationId: ObjectId,
    lastReadMessageId: ObjectId,
    invalidatedAt: Date,
    session: ClientSession
  ): Promise<NotificationMutationResult[]> {
    if (!session.inTransaction()) {
      throw new Error('Directed notification read invalidation requires an active transaction')
    }

    const results: NotificationMutationResult[] = []
    let cursor: ObjectId | null = null
    do {
      const page = await this.repository.invalidateMatchingPage(
        {
          recipient_id: recipientId,
          type: { $in: DIRECTED_MESSAGE_TYPES },
          target_type: NotificationTargetType.Message,
          target_id: { $lte: lastReadMessageId },
          'context.conversation_id': conversationId
        },
        invalidatedAt,
        cursor,
        { session, batch_size: INVALIDATION_PAGE_SIZE }
      )
      results.push(...page.results)
      cursor = page.next_cursor
    } while (cursor)

    return results
  }

  deliverAfterCommit(results: NotificationMutationResult[]): void {
    for (const result of results) {
      if (result.status !== 'invalidated') continue
      this.deliveryService.deliverRemoved(result.notification, result.unread_state)
      if (result.unread_state) this.deliveryService.deliverUnreadCount(result.unread_state)
    }
  }
}

export default new DirectedNotificationReadService()
