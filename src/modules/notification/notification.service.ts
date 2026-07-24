import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import { Notification } from '~/schemas'
import { NotificationType } from '~/constants/enums'
import { getIO } from '~/socket'

class NotificationService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  async createNotification(
    recipient_id: string,
    sender_id: string | null,
    type: NotificationType,
    target_id?: string
  ) {
    if (recipient_id === sender_id) return null // Don't notify self

    const notification = new Notification({
      recipient_id: new this.databaseService.ObjectId(recipient_id),
      sender_id: sender_id ? new this.databaseService.ObjectId(sender_id) : null,
      type,
      target_id: target_id ? new this.databaseService.ObjectId(target_id) : undefined
    })

    const result = await this.databaseService.notifications.insertOne(notification)
    notification._id = result.insertedId

    // Real-time socket event
    try {
      getIO().to(recipient_id).emit('@notification:new', notification)
    } catch (error) {
      console.error('Socket not initialized yet or error emitting notification')
    }

    return notification
  }

  async getNotifications(userId: string, cursor: string | undefined, limit: number) {
    const recipientId = new this.databaseService.ObjectId(userId)
    const matchStage: any = { recipient_id: recipientId }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const notifications = await this.databaseService.notifications
      .find(matchStage)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const unreadCount = await this.databaseService.notifications.countDocuments({
      recipient_id: recipientId,
      is_read: false
    })

    const has_next_page = notifications.length === limit
    const next_cursor = has_next_page ? notifications[notifications.length - 1]._id.toString() : null

    return { notifications, unreadCount, next_cursor, has_next_page }
  }

  async markAllAsRead(userId: string) {
    const result = await this.databaseService.notifications.updateMany(
      { recipient_id: new this.databaseService.ObjectId(userId), is_read: false },
      { $set: { is_read: true } }
    )
    return { updatedCount: result.modifiedCount }
  }

  async markAsRead(userId: string, notificationId: string) {
    const result = await this.databaseService.notifications.updateOne(
      {
        _id: new this.databaseService.ObjectId(notificationId),
        recipient_id: new this.databaseService.ObjectId(userId)
      },
      { $set: { is_read: true } }
    )
    return { success: result.modifiedCount > 0 }
  }
}

const notificationService = new NotificationService()
export default notificationService
