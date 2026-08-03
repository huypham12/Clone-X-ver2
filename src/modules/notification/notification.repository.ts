import type { ClientSession, Filter, ObjectId, WithId } from 'mongodb'
import { isDeepStrictEqual } from 'util'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { Notification } from '~/schemas'
import type {
  IndividualNotificationIntent,
  IndividualNotificationWriteResult,
  NotificationMutationResult
} from './notification-event.type'
import type { NotificationContext } from '~/schemas/Notification.schema'
import { NotificationUnreadService, type NotificationUnreadSnapshot } from './notification-unread.service'

export interface NotificationRepositoryOptions {
  session?: ClientSession
}

export interface MarkNotificationReadResult {
  exists: boolean
  transitioned: boolean
  unread_state: NotificationUnreadSnapshot
}

export interface MarkAllNotificationsReadResult {
  updated_count: number
  unread_state: NotificationUnreadSnapshot
}

export interface NotificationReadAllCutoff {
  unread_since: Date
  created_at: Date
  _id: ObjectId
}

export interface InvalidateMatchingOptions extends NotificationRepositoryOptions {
  batch_size?: number
}

export interface InvalidateMatchingPageResult {
  results: NotificationMutationResult[]
  next_cursor: ObjectId | null
}

export class NotificationRepository {
  private readonly databaseService: DatabaseService

  constructor(
    databaseService: DatabaseService = sharedDatabaseService,
    private readonly unreadService: NotificationUnreadService = new NotificationUnreadService(databaseService)
  ) {
    this.databaseService = databaseService
  }

  async createIndividualNotification(
    intent: IndividualNotificationIntent,
    options: NotificationRepositoryOptions = {}
  ): Promise<IndividualNotificationWriteResult> {
    const session = this.requireSession(options)
    const actorIdsPreview = intent.sender_id ? [intent.sender_id] : []
    const notification = new Notification({
      recipient_id: intent.recipient_id,
      sender_id: intent.sender_id,
      type: intent.type,
      target_id: intent.target_id ?? undefined,
      target_type: intent.target_type,
      actor_ids_preview: actorIdsPreview,
      actor_count: actorIdsPreview.length,
      context: intent.context,
      deduplication_key: intent.deduplication_key,
      aggregation_active: false,
      read_at: null,
      unread_since: new Date(),
      created_at: intent.occurred_at,
      updated_at: intent.occurred_at,
      invalidated_at: null,
      schema_version: 2
    })

    try {
      const result = await this.databaseService.notifications.findOneAndUpdate(
        { deduplication_key: intent.deduplication_key },
        { $setOnInsert: notification },
        {
          upsert: true,
          returnDocument: 'after',
          includeResultMetadata: true,
          session
        }
      )
      if (!result.value) throw new Error('Notification upsert returned no document')
      this.assertDeduplicationOwner(result.value, intent)
      if (result.lastErrorObject?.upserted === undefined && result.value.invalidated_at) {
        const reactivated = await this.databaseService.notifications.findOneAndUpdate(
          { _id: result.value._id, invalidated_at: { $ne: null } },
          {
            $set: {
              sender_id: intent.sender_id,
              target_id: intent.target_id,
              target_type: intent.target_type,
              actor_ids_preview: actorIdsPreview,
              actor_count: actorIdsPreview.length,
              context: intent.context,
              is_read: false,
              read_at: null,
              unread_since: new Date(),
              invalidated_at: null,
              updated_at: intent.occurred_at
            }
          },
          { returnDocument: 'after', session }
        )
        if (reactivated) {
          const unreadState = await this.unreadService.increment(intent.recipient_id, 1, intent.occurred_at, { session })
          return { status: 'updated', notification: reactivated, unread_state: unreadState }
        }
      }
      if (result.lastErrorObject?.upserted !== undefined) {
        const unreadState = await this.unreadService.increment(intent.recipient_id, 1, intent.occurred_at, { session })
        return { status: 'created', notification: result.value, unread_state: unreadState }
      }
      return {
        status: 'duplicate',
        notification: result.value
      }
    } catch (error: unknown) {
      if (!this.isDuplicateKeyError(error)) throw error
      const existing = await this.databaseService.notifications.findOne(
        { deduplication_key: intent.deduplication_key },
        { session }
      )
      if (!existing) throw error
      this.assertDeduplicationOwner(existing, intent)
      return { status: 'duplicate', notification: existing }
    }
  }

  async createIndividualNotificationsBatch(
    intents: IndividualNotificationIntent[],
    options: NotificationRepositoryOptions = {}
  ): Promise<IndividualNotificationWriteResult[]> {
    if (intents.length === 0) return []
    const session = this.requireSession(options)
    const uniqueIntents = new Map<string, IndividualNotificationIntent>()
    for (const intent of intents) {
      const existingIntent = uniqueIntents.get(intent.deduplication_key)
      if (existingIntent && !isDeepStrictEqual(existingIntent, intent)) {
        throw new Error(`Conflicting notification batch key: ${intent.deduplication_key}`)
      }
      uniqueIntents.set(intent.deduplication_key, intent)
    }
    const normalized = [...uniqueIntents.values()]
    const keys = normalized.map((intent) => intent.deduplication_key)
    const existing = await this.databaseService.notifications
      .find({ deduplication_key: { $in: keys } }, { session })
      .toArray()
    const existingByKey = new Map(
      existing.flatMap((notification) =>
        notification.deduplication_key
          ? ([[notification.deduplication_key, notification]] as const)
          : []
      )
    )
    for (const intent of normalized) {
      const notification = existingByKey.get(intent.deduplication_key)
      if (notification) this.assertDeduplicationOwner(notification, intent)
    }

    await this.databaseService.notifications.bulkWrite(
      normalized.map((intent) => {
        const actorIdsPreview = intent.sender_id ? [intent.sender_id] : []
        return {
          updateOne: {
            filter: { deduplication_key: intent.deduplication_key },
            update: {
              $setOnInsert: new Notification({
                recipient_id: intent.recipient_id,
                sender_id: intent.sender_id,
                type: intent.type,
                target_id: intent.target_id ?? undefined,
                target_type: intent.target_type,
                actor_ids_preview: actorIdsPreview,
                actor_count: actorIdsPreview.length,
                context: intent.context,
                deduplication_key: intent.deduplication_key,
                aggregation_active: false,
                read_at: null,
                unread_since: new Date(),
                created_at: intent.occurred_at,
                updated_at: intent.occurred_at,
                invalidated_at: null,
                schema_version: 2
              })
            },
            upsert: true
          }
        }
      }),
      { session, ordered: false }
    )
    const persisted = await this.databaseService.notifications
      .find({ deduplication_key: { $in: keys } }, { session })
      .toArray()
    const persistedByKey = new Map(
      persisted.flatMap((notification) =>
        notification.deduplication_key
          ? ([[notification.deduplication_key, notification]] as const)
          : []
      )
    )
    const createdIntents = normalized.filter((intent) => !existingByKey.has(intent.deduplication_key))
    const unreadByRecipient = await this.unreadService.incrementBatch(
      createdIntents.map((intent) => ({ recipient_id: intent.recipient_id, amount: 1 })),
      createdIntents.reduce(
        (latest, intent) => (intent.occurred_at > latest ? intent.occurred_at : latest),
        createdIntents[0]?.occurred_at ?? new Date()
      ),
      { session }
    )
    return normalized.map((intent) => {
      const notification = persistedByKey.get(intent.deduplication_key)
      if (!notification) throw new Error('Notification batch persistence returned an incomplete result')
      this.assertDeduplicationOwner(notification, intent)
      if (existingByKey.has(intent.deduplication_key)) {
        return { status: 'duplicate', notification }
      }
      const unreadState = unreadByRecipient.get(intent.recipient_id.toHexString())
      if (!unreadState) throw new Error('Notification batch unread state is missing')
      return { status: 'created', notification, unread_state: unreadState }
    })
  }

  async findRecipientPage(
    filter: Filter<Notification>,
    limit: number,
    options: NotificationRepositoryOptions = {}
  ): Promise<WithId<Notification>[]> {
    return this.databaseService.notifications
      .find(filter, { session: options.session })
      .sort({ created_at: -1, _id: -1 })
      .hint({ recipient_id: 1, created_at: -1, _id: -1 })
      .limit(limit)
      .toArray()
  }

  async findOwnedById(
    recipientId: ObjectId,
    notificationId: ObjectId,
    options: NotificationRepositoryOptions = {}
  ): Promise<WithId<Notification> | null> {
    return this.databaseService.notifications.findOne(
      { _id: notificationId, recipient_id: recipientId },
      { session: options.session }
    )
  }

  async markAllAsRead(
    recipientId: ObjectId,
    readAt: Date,
    cutoff: NotificationReadAllCutoff,
    options: NotificationRepositoryOptions = {}
  ): Promise<MarkAllNotificationsReadResult> {
    const session = this.requireSession(options)
    const result = await this.databaseService.notifications.updateMany(
      {
        recipient_id: recipientId,
        is_read: false,
        invalidated_at: null,
        $or: [
          { unread_since: { $lte: cutoff.unread_since } },
          {
            unread_since: { $exists: false },
            created_at: { $lte: cutoff.created_at },
            _id: { $lt: cutoff._id }
          }
        ]
      },
      {
        $set: {
          is_read: true,
          read_at: readAt,
          updated_at: readAt,
          aggregation_active: false
        }
      },
      { session }
    )
    const unreadState = result.modifiedCount
      ? await this.unreadService.decrement(recipientId, result.modifiedCount, readAt, { session })
      : await this.unreadService.get(recipientId, session)
    return { updated_count: result.modifiedCount, unread_state: unreadState }
  }

  async markAsRead(
    recipientId: ObjectId,
    notificationId: ObjectId,
    readAt: Date,
    options: NotificationRepositoryOptions = {}
  ): Promise<MarkNotificationReadResult> {
    const session = this.requireSession(options)
    const result = await this.databaseService.notifications.updateOne(
      { _id: notificationId, recipient_id: recipientId, is_read: false, invalidated_at: null },
      {
        $set: {
          is_read: true,
          read_at: readAt,
          updated_at: readAt,
          aggregation_active: false
        }
      },
      { session }
    )

    if (result.matchedCount > 0) {
      const unreadState = await this.unreadService.decrement(recipientId, 1, readAt, { session })
      return { exists: true, transitioned: true, unread_state: unreadState }
    }

    const existing = await this.databaseService.notifications.findOne(
      { _id: notificationId, recipient_id: recipientId },
      { projection: { _id: 1 }, session }
    )
    return {
      exists: existing !== null,
      transitioned: false,
      unread_state: await this.unreadService.get(recipientId, session)
    }
  }

  async invalidate(
    recipientId: ObjectId,
    notificationId: ObjectId,
    invalidatedAt: Date,
    options: NotificationRepositoryOptions = {}
  ): Promise<boolean> {
    const session = this.requireSession(options)
    const notification = await this.databaseService.notifications.findOneAndUpdate(
      { _id: notificationId, recipient_id: recipientId, invalidated_at: null },
      {
        $set: {
          invalidated_at: invalidatedAt,
          updated_at: invalidatedAt,
          aggregation_active: false
        }
      },
      { returnDocument: 'after', session }
    )
    if (notification && !notification.is_read) {
      await this.unreadService.decrement(recipientId, 1, invalidatedAt, { session })
    }
    return notification !== null
  }

  async invalidateByDeduplicationKey(
    deduplicationKey: string,
    invalidatedAt: Date,
    options: NotificationRepositoryOptions = {}
  ): Promise<NotificationMutationResult | null> {
    const session = this.requireSession(options)
    const notification = await this.databaseService.notifications.findOneAndUpdate(
      { deduplication_key: deduplicationKey, invalidated_at: null },
      {
        $set: {
          invalidated_at: invalidatedAt,
          updated_at: invalidatedAt,
          aggregation_active: false
        }
      },
      { returnDocument: 'after', session }
    )
    if (!notification) return null
    const unreadState = !notification.is_read
      ? await this.unreadService.decrement(notification.recipient_id, 1, invalidatedAt, { session })
      : undefined
    return { status: 'invalidated', notification, unread_state: unreadState }
  }

  async invalidateMatchingPage(
    filter: Filter<Notification>,
    invalidatedAt: Date,
    afterId: ObjectId | null,
    options: InvalidateMatchingOptions = {}
  ): Promise<InvalidateMatchingPageResult> {
    const session = this.requireSession(options)
    const batchSize = Math.max(1, Math.min(options.batch_size ?? 500, 1000))
    const pageFilter: Filter<Notification> = {
      $and: [filter, { invalidated_at: null }, ...(afterId ? [{ _id: { $gt: afterId } }] : [])]
    }
    const page = await this.databaseService.notifications
      .find(pageFilter, { projection: { _id: 1 }, session })
      .sort({ _id: 1 })
      .limit(batchSize + 1)
      .toArray()
    const selected = page.slice(0, batchSize)
    const results: NotificationMutationResult[] = []
    for (const item of selected) {
      const notification = await this.databaseService.notifications.findOneAndUpdate(
        { _id: item._id, invalidated_at: null },
        {
          $set: {
            invalidated_at: invalidatedAt,
            updated_at: invalidatedAt,
            aggregation_active: false
          }
        },
        { returnDocument: 'after', session }
      )
      if (!notification) continue
      const unreadState = !notification.is_read
        ? await this.unreadService.decrement(notification.recipient_id, 1, invalidatedAt, { session })
        : undefined
      results.push({ status: 'invalidated', notification, unread_state: unreadState })
    }
    return {
      results,
      next_cursor: page.length > batchSize && selected.length > 0 ? selected[selected.length - 1]._id : null
    }
  }

  async updateContextByDeduplicationKey(
    deduplicationKey: string,
    context: NotificationContext,
    updatedAt: Date,
    options: NotificationRepositoryOptions = {}
  ): Promise<NotificationMutationResult | null> {
    const existing = await this.databaseService.notifications.findOne(
      { deduplication_key: deduplicationKey, invalidated_at: null },
      { session: options.session }
    )
    if (!existing) return null
    if (isDeepStrictEqual(existing.context ?? {}, context)) {
      return { status: 'duplicate', notification: existing }
    }

    const notification = await this.databaseService.notifications.findOneAndUpdate(
      { _id: existing._id, invalidated_at: null },
      { $set: { context, updated_at: updatedAt } },
      { returnDocument: 'after', session: options.session }
    )
    return notification ? { status: 'context_updated', notification } : null
  }

  private assertDeduplicationOwner(notification: WithId<Notification>, intent: IndividualNotificationIntent): void {
    const sameSender =
      (notification.sender_id === null && intent.sender_id === null) ||
      notification.sender_id?.equals(intent.sender_id) === true
    const sameTarget =
      (notification.target_id === null && intent.target_id === null) ||
      notification.target_id?.equals(intent.target_id) === true
    if (
      !notification.recipient_id.equals(intent.recipient_id) ||
      notification.type !== intent.type ||
      notification.deduplication_key !== intent.deduplication_key ||
      !sameSender ||
      !sameTarget ||
      notification.target_type !== intent.target_type ||
      !isDeepStrictEqual(notification.context ?? {}, intent.context)
    ) {
      throw new Error(`Notification deduplication key collision: ${intent.deduplication_key}`)
    }
  }

  private isDuplicateKeyError(error: unknown): error is { code: number } {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  }

  private requireSession(options: NotificationRepositoryOptions): ClientSession {
    if (!options.session) throw new Error('Notification mutation requires an active MongoDB session')
    return options.session
  }
}
