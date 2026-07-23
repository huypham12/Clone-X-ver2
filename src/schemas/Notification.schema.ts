import { ObjectId } from 'mongodb'
import { NotificationType } from '~/constants/enums'

interface NotificationConstructor {
  _id?: ObjectId
  recipient_id: ObjectId // Người nhận thông báo
  sender_id: ObjectId | null // Người tạo ra thông báo, null nếu là hệ thống
  type: NotificationType
  target_id?: ObjectId // ID của Tweet, User hoặc thực thể liên quan
  is_read?: boolean
  created_at?: Date
}

export default class Notification {
  _id?: ObjectId
  recipient_id: ObjectId
  sender_id: ObjectId | null
  type: NotificationType
  target_id: ObjectId | null
  is_read: boolean
  created_at: Date

  constructor(notification: NotificationConstructor) {
    this._id = notification._id || new ObjectId()
    this.recipient_id = notification.recipient_id
    this.sender_id = notification.sender_id
    this.type = notification.type
    this.target_id = notification.target_id || null
    this.is_read = notification.is_read || false
    this.created_at = notification.created_at || new Date()
  }
}
