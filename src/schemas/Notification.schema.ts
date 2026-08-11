import { ObjectId } from 'mongodb'
import { NotificationTargetType, NotificationType } from '~/constants/enums'

export type NotificationContext = Record<string, unknown>

interface NotificationConstructor {
  _id?: ObjectId
  recipient_id: ObjectId // Người nhận thông báo
  sender_id: ObjectId | null // Người tạo ra thông báo, null nếu là hệ thống
  type: NotificationType
  target_id?: ObjectId // ID của Tweet, User hoặc thực thể liên quan
  is_read?: boolean
  created_at?: Date
  target_type?: NotificationTargetType
  actor_ids_preview?: ObjectId[]
  actor_count?: number
  context?: NotificationContext
  deduplication_key?: string
  aggregation_key?: string
  aggregation_active?: boolean
  read_at?: Date | null
  unread_since?: Date
  updated_at?: Date
  invalidated_at?: Date | null
}

export default class Notification {
  _id?: ObjectId
  recipient_id: ObjectId
  sender_id: ObjectId | null
  type: NotificationType
  target_id: ObjectId | null
  is_read: boolean
  created_at: Date
  target_type?: NotificationTargetType
  actor_ids_preview?: ObjectId[]
  actor_count?: number
  context?: NotificationContext
  deduplication_key?: string
  aggregation_key?: string
  aggregation_active?: boolean
  read_at?: Date | null
  unread_since?: Date
  updated_at?: Date
  invalidated_at?: Date | null

  constructor(notification: NotificationConstructor) {
    this._id = notification._id || new ObjectId()
    this.recipient_id = notification.recipient_id
    this.sender_id = notification.sender_id
    this.type = notification.type
    this.target_id = notification.target_id ?? null
    this.is_read = notification.is_read ?? false
    this.created_at = notification.created_at ?? new Date()
    if (notification.target_type !== undefined) this.target_type = notification.target_type
    if (notification.actor_ids_preview !== undefined)
      this.actor_ids_preview = notification.actor_ids_preview.slice(0, 3)
    if (notification.actor_count !== undefined) this.actor_count = notification.actor_count
    if (notification.context !== undefined) this.context = notification.context
    if (notification.deduplication_key !== undefined) this.deduplication_key = notification.deduplication_key
    if (notification.aggregation_key !== undefined) this.aggregation_key = notification.aggregation_key
    if (notification.aggregation_active !== undefined) this.aggregation_active = notification.aggregation_active
    if (notification.read_at !== undefined) this.read_at = notification.read_at
    if (notification.unread_since !== undefined) this.unread_since = notification.unread_since
    if (notification.updated_at !== undefined) this.updated_at = notification.updated_at
    if (notification.invalidated_at !== undefined) this.invalidated_at = notification.invalidated_at
  }
}
