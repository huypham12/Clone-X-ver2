import { randomUUID } from 'crypto'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationType } from '~/constants/enums'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type { NotificationPageData } from './dto'
import { NotificationRepository } from './notification.repository'
import { NotificationQueryService } from './notification-query.service'
import { NotificationPolicyService } from './notification-policy.service'
import { NotificationDeliveryService } from './notification-delivery.service'
import { InlineDomainEventPublisher } from '~/modules/events/domain-event.publisher'
import { DomainAggregateType, DomainEventType } from '~/modules/events/domain-event.type'
import { NotificationEventHandler } from './notification-event.handler'
import type { NotificationEventHandlerResult } from './notification-event.type'
import { NotificationUnreadService } from './notification-unread.service'

export class NotificationService {
  private readonly databaseService: DatabaseService
  private readonly repository: NotificationRepository
  private readonly queryService: NotificationQueryService
  private readonly inlinePublisher: InlineDomainEventPublisher<NotificationEventHandlerResult>
  private readonly deliveryService: NotificationDeliveryService
  private readonly unreadService: NotificationUnreadService
  private readonly eventHandler: NotificationEventHandler

  constructor(
    databaseService: DatabaseService = sharedDatabaseService,
    repository: NotificationRepository = new NotificationRepository(databaseService),
    queryService: NotificationQueryService = new NotificationQueryService(databaseService, repository),
    policyService: NotificationPolicyService = new NotificationPolicyService(databaseService),
    deliveryService: NotificationDeliveryService = new NotificationDeliveryService(),
    eventHandler: NotificationEventHandler = new NotificationEventHandler(repository, policyService, deliveryService),
    inlinePublisher: InlineDomainEventPublisher<NotificationEventHandlerResult> = new InlineDomainEventPublisher(
      eventHandler
    ),
    unreadService: NotificationUnreadService = new NotificationUnreadService(databaseService)
  ) {
    this.databaseService = databaseService
    this.repository = repository
    this.queryService = queryService
    this.inlinePublisher = inlinePublisher
    this.deliveryService = deliveryService
    this.unreadService = unreadService
    this.eventHandler = eventHandler
  }

  /** @deprecated Compatibility facade only. Production business flows publish typed outbox events. */
  async createNotification(recipient_id: string, sender_id: string | null, type: NotificationType, target_id?: string) {
    const eventId = randomUUID()
    const recipientId = new this.databaseService.ObjectId(recipient_id)
    const actorId = sender_id ? new this.databaseService.ObjectId(sender_id) : null
    const targetId = target_id ? new this.databaseService.ObjectId(target_id) : null
    const event = {
      event_id: eventId,
      type: DomainEventType.LegacyNotificationRequested,
      aggregate_type: DomainAggregateType.LegacyNotification,
      aggregate_id: targetId ?? recipientId,
      actor_id: actorId,
      occurred_at: new Date(),
      payload: {
        recipient_id: recipientId,
        notification_type: type,
        target_id: targetId,
        source_type: 'LEGACY',
        source_id: eventId
      }
    } as const
    let result: NotificationEventHandlerResult | undefined
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        result = await this.inlinePublisher.publish(event, { session, deliver: false })
      })
    } finally {
      await session.endSession()
    }
    if (!result) throw new Error('Notification transaction committed without a handler result')
    this.eventHandler.deliverAfterCommit(result)
    return result.status === 'batch' ? null : result.notification
  }

  async getNotifications(userId: string, cursor: string | undefined, limit: number): Promise<NotificationPageData> {
    return this.queryService.getNotifications(userId, cursor, limit)
  }

  async markAllAsRead(userId: string) {
    const recipientId = new this.databaseService.ObjectId(userId)
    const readAt = new Date()
    const cutoff = { unread_since: readAt, created_at: readAt, _id: new this.databaseService.ObjectId() }
    const session = this.databaseService.startSession()
    let result: Awaited<ReturnType<NotificationRepository['markAllAsRead']>> | undefined
    try {
      await session.withTransaction(async () => {
        result = await this.repository.markAllAsRead(recipientId, readAt, cutoff, { session })
      })
    } finally {
      await session.endSession()
    }
    if (!result) throw new Error('Notification read-all transaction returned no result')
    this.deliveryService.deliverReadState(userId, {
      action: 'read_all',
      notification_id: null,
      read_at: readAt,
      updated_count: result.updated_count,
      unread_count: result.unread_state.unread_count,
      version: result.unread_state.version
    })
    return {
      updatedCount: result.updated_count,
      unreadCount: result.unread_state.unread_count,
      version: result.unread_state.version
    }
  }

  async markAsRead(userId: string, notificationId: string) {
    const recipientId = new this.databaseService.ObjectId(userId)
    const readAt = new Date()
    const session = this.databaseService.startSession()
    let result: Awaited<ReturnType<NotificationRepository['markAsRead']>> | undefined
    try {
      await session.withTransaction(async () => {
        result = await this.repository.markAsRead(
          recipientId,
          new this.databaseService.ObjectId(notificationId),
          readAt,
          { session }
        )
      })
    } finally {
      await session.endSession()
    }
    if (!result) throw new Error('Notification mark-read transaction returned no result')
    if (!result.exists) {
      throw new HttpError('Notification not found', HTTP_STATUS.NOT_FOUND)
    }

    this.deliveryService.deliverReadState(userId, {
      action: 'mark_one',
      notification_id: notificationId,
      read_at: readAt,
      updated_count: result.transitioned ? 1 : 0,
      unread_count: result.unread_state.unread_count,
      version: result.unread_state.version
    })
    return {
      success: true as const,
      unreadCount: result.unread_state.unread_count,
      version: result.unread_state.version
    }
  }

  async getUnreadCount(userId: string) {
    const state = await this.unreadService.get(new this.databaseService.ObjectId(userId))
    return { unreadCount: state.unread_count, version: state.version, updated_at: state.updated_at }
  }
}

const notificationService = new NotificationService()
export default notificationService
