import type { WithId } from 'mongodb'
import type Notification from '~/schemas/Notification.schema'
import { inProcessRealtimeEmitter } from '~/modules/realtime/in-process-realtime-emitter'
import type { RealtimeEmitter } from '~/modules/realtime/realtime-emitter'
import type { NotificationDeliveryResult } from './notification.type'
import type { NotificationUnreadSnapshot } from './notification-unread.service'

export interface NotificationReadStatePayload {
  action: 'mark_one' | 'read_all'
  notification_id: string | null
  read_at: Date
  updated_count: number
  unread_count: number
  version: number
}

export class NotificationDeliveryService {
  constructor(private readonly realtimeEmitter: RealtimeEmitter = inProcessRealtimeEmitter) {}

  deliverNew(notification: WithId<Notification>): NotificationDeliveryResult {
    try {
      this.realtimeEmitter.emit(
        notification.recipient_id.toHexString(),
        '@notification:new',
        this.toPublicNotification(notification)
      )
      return { delivered: true }
    } catch (error: unknown) {
      console.error('Could not emit persisted notification', {
        notification_id: notification._id.toHexString(),
        recipient_id: notification.recipient_id.toHexString(),
        error: error instanceof Error ? error.message : String(error)
      })
      return { delivered: false }
    }
  }

  deliverUnreadCount(state: NotificationUnreadSnapshot): NotificationDeliveryResult {
    return this.emit(state.recipient_id.toHexString(), '@notification:unread-count', {
      unread_count: state.unread_count,
      version: state.version,
      updated_at: state.updated_at
    })
  }

  deliverReadState(recipientId: string, payload: NotificationReadStatePayload): NotificationDeliveryResult {
    return this.emit(recipientId, '@notification:read-state', payload)
  }

  deliverUpdated(notification: WithId<Notification>): NotificationDeliveryResult {
    return this.emit(
      notification.recipient_id.toHexString(),
      '@notification:updated',
      this.toPublicNotification(notification)
    )
  }

  deliverRemoved(notification: WithId<Notification>, state?: NotificationUnreadSnapshot): NotificationDeliveryResult {
    return this.emit(notification.recipient_id.toHexString(), '@notification:removed', {
      notification_id: notification._id.toHexString(),
      aggregation_key: notification.aggregation_key ?? null,
      unread_count: state?.unread_count,
      version: state?.version,
      updated_at: notification.updated_at ?? new Date()
    })
  }

  private emit(room: string, event: string, payload: unknown): NotificationDeliveryResult {
    try {
      this.realtimeEmitter.emit(room, event, payload)
      return { delivered: true }
    } catch (error: unknown) {
      console.error('Could not emit persisted notification state', {
        room,
        event,
        error: error instanceof Error ? error.message : String(error)
      })
      return { delivered: false }
    }
  }

  private toPublicNotification(notification: WithId<Notification>) {
    const payload = { ...notification }
    Reflect.deleteProperty(payload, 'unread_since')
    return payload
  }
}
