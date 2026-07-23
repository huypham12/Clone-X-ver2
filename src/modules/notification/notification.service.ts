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

  async getNotifications(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit
    const recipientId = new this.databaseService.ObjectId(userId)

    const notifications = await this.databaseService.notifications
      .find({ recipient_id: recipientId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray()

    const unreadCount = await this.databaseService.notifications.countDocuments({
      recipient_id: recipientId,
      is_read: false
    })

    const total = await this.databaseService.notifications.countDocuments({
      recipient_id: recipientId
    })

    return { notifications, unreadCount, total, page, totalPages: Math.ceil(total / limit) }
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
