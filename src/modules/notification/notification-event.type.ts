import type { ClientSession, ObjectId, WithId } from 'mongodb'
import type { NotificationTargetType, NotificationType } from '~/constants/enums'
import type Notification from '~/schemas/Notification.schema'
import type { NotificationContext } from '~/schemas/Notification.schema'
import type { NotificationUnreadSnapshot } from './notification-unread.service'

export interface IndividualNotificationIntent {
  recipient_id: ObjectId
  sender_id: ObjectId | null
  type: NotificationType
  target_id: ObjectId | null
  target_type?: NotificationTargetType
  context: NotificationContext
  deduplication_key: string
  occurred_at: Date
}

export type IndividualNotificationWriteResult =
  | { status: 'created'; notification: WithId<Notification>; unread_state: NotificationUnreadSnapshot }
  | { status: 'duplicate'; notification: WithId<Notification> }
  | { status: 'updated'; notification: WithId<Notification>; unread_state: NotificationUnreadSnapshot }

export type NotificationMutationResult =
  | IndividualNotificationWriteResult
  | { status: 'invalidated'; notification: WithId<Notification>; unread_state?: NotificationUnreadSnapshot }
  | { status: 'context_updated'; notification: WithId<Notification> }
  | { status: 'aggregate_updated'; notification: WithId<Notification> }
  | { status: 'aggregate_removed'; notification: WithId<Notification>; unread_state?: NotificationUnreadSnapshot }
  | { status: 'suppressed'; notification: null; reason: string }

export type NotificationEventHandlerResult =
  | NotificationMutationResult
  | { status: 'batch'; results: NotificationMutationResult[] }

const isPersistedMutation = (result: NotificationMutationResult): boolean =>
  result.status !== 'duplicate' && result.status !== 'suppressed'

export const countNotificationMutations = (result: NotificationEventHandlerResult | undefined): number => {
  if (!result) return 0
  if (result.status === 'batch') return result.results.filter(isPersistedMutation).length
  return isPersistedMutation(result) ? 1 : 0
}

export interface NotificationEventHandlerOptions {
  session?: ClientSession
  deliver?: boolean
}
