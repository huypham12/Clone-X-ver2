import { ObjectId, type ClientSession } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'

export interface NotificationUnreadSnapshot {
  recipient_id: ObjectId
  unread_count: number
  version: number
  updated_at: Date
}

interface NotificationUnreadMutationOptions {
  session: ClientSession
}

export class NotificationUnreadService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async increment(
    recipientId: ObjectId,
    amount: number,
    now: Date,
    options: NotificationUnreadMutationOptions
  ): Promise<NotificationUnreadSnapshot> {
    return this.adjust(recipientId, Math.max(0, amount), now, options)
  }

  async decrement(
    recipientId: ObjectId,
    amount: number,
    now: Date,
    options: NotificationUnreadMutationOptions
  ): Promise<NotificationUnreadSnapshot> {
    return this.adjust(recipientId, -Math.max(0, amount), now, options)
  }

  async incrementBatch(
    increments: Array<{ recipient_id: ObjectId; amount: number }>,
    now: Date,
    options: NotificationUnreadMutationOptions
  ): Promise<Map<string, NotificationUnreadSnapshot>> {
    const byRecipient = new Map<string, { recipient_id: ObjectId; amount: number }>()
    for (const increment of increments) {
      if (increment.amount <= 0) continue
      const key = increment.recipient_id.toHexString()
      const current = byRecipient.get(key)
      if (current) current.amount += increment.amount
      else byRecipient.set(key, { recipient_id: increment.recipient_id, amount: increment.amount })
    }
    const normalized = [...byRecipient.values()]
    if (normalized.length === 0) return new Map()

    await this.databaseService.notificationStates.bulkWrite(
      normalized.map((increment) => ({
        updateOne: {
          filter: { recipient_id: increment.recipient_id },
          update: [
            {
              $set: {
                recipient_id: increment.recipient_id,
                unread_count: {
                  $add: [{ $ifNull: ['$unread_count', 0] }, increment.amount]
                },
                version: { $add: [{ $ifNull: ['$version', 0] }, 1] },
                updated_at: now
              }
            }
          ],
          upsert: true
        }
      })),
      { session: options.session, ordered: false }
    )

    const recipientIds = normalized.map((item) => item.recipient_id)
    const states = await this.databaseService.notificationStates
      .find({ recipient_id: { $in: recipientIds } }, { session: options.session })
      .toArray()
    return new Map(states.map((state) => [state.recipient_id.toHexString(), state]))
  }

  async get(recipientId: ObjectId, session?: ClientSession): Promise<NotificationUnreadSnapshot> {
    const state = await this.databaseService.notificationStates.findOne({ recipient_id: recipientId }, { session })
    return state ?? { recipient_id: recipientId, unread_count: 0, version: 0, updated_at: new Date(0) }
  }

  async reconcile(recipientId: ObjectId, now: Date, session?: ClientSession): Promise<NotificationUnreadSnapshot> {
    const unreadCount = await this.databaseService.notifications.countDocuments(
      { recipient_id: recipientId, is_read: false, invalidated_at: null },
      { session }
    )
    const state = await this.databaseService.notificationStates.findOneAndUpdate(
      { recipient_id: recipientId },
      [
        {
          $set: {
            recipient_id: recipientId,
            unread_count: unreadCount,
            version: {
              $cond: [
                { $eq: [{ $ifNull: ['$unread_count', -1] }, unreadCount] },
                { $ifNull: ['$version', 0] },
                { $add: [{ $ifNull: ['$version', 0] }, 1] }
              ]
            },
            updated_at: now
          }
        }
      ],
      { upsert: true, returnDocument: 'after', session }
    )
    if (!state) throw new Error('Notification state reconciliation returned no document')
    return state
  }

  private async adjust(
    recipientId: ObjectId,
    delta: number,
    now: Date,
    options: NotificationUnreadMutationOptions
  ): Promise<NotificationUnreadSnapshot> {
    if (delta === 0) return this.get(recipientId, options.session)
    const state = await this.databaseService.notificationStates.findOneAndUpdate(
      { recipient_id: recipientId },
      [
        {
          $set: {
            recipient_id: recipientId,
            unread_count: { $max: [0, { $add: [{ $ifNull: ['$unread_count', 0] }, delta] }] },
            version: { $add: [{ $ifNull: ['$version', 0] }, 1] },
            updated_at: now
          }
        }
      ],
      { upsert: true, returnDocument: 'after', session: options.session }
    )
    if (!state) throw new Error('Notification unread mutation returned no state')
    return state
  }
}
