import { ObjectId, type ClientSession, type WithId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { Notification, NotificationActor } from '~/schemas'
import type NotificationModel from '~/schemas/Notification.schema'
import type { NotificationMutationResult } from './notification-event.type'
import type { AggregateNotificationCommand } from './notification.type'
import { NotificationUnreadService } from './notification-unread.service'

interface AggregationOptions {
  session: ClientSession
}

export class NotificationAggregationService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly unreadService: NotificationUnreadService = new NotificationUnreadService(databaseService)
  ) {}

  async addActor(
    command: AggregateNotificationCommand,
    options: AggregationOptions
  ): Promise<NotificationMutationResult> {
    const active = await this.databaseService.notifications.findOne(
      {
        recipient_id: command.recipient_id,
        aggregation_key: command.aggregation_key,
        aggregation_active: true,
        invalidated_at: null
      },
      { session: options.session }
    )
    if (!active) return this.createWindow(command, options)

    const existingActor = await this.databaseService.notificationActors.findOne(
      { notification_id: active._id, actor_id: command.actor_id },
      { session: options.session }
    )
    if (
      existingActor?.source_key === command.source_key &&
      existingActor.last_event_id === command.event_id
    ) {
      return { status: 'duplicate', notification: active }
    }

    if (existingActor) {
      await this.databaseService.notificationActors.updateOne(
        { _id: existingActor._id, source_key: existingActor.source_key },
        {
          $set: {
            source_key: command.source_key,
            last_event_id: command.event_id,
            context: command.context
          },
          $max: { updated_at: command.occurred_at }
        },
        { session: options.session }
      )
    } else {
      await this.databaseService.notificationActors.insertOne(
        new NotificationActor({
          notification_id: active._id,
          actor_id: command.actor_id,
          source_key: command.source_key,
          last_event_id: command.event_id,
          context: command.context,
          created_at: command.occurred_at,
          updated_at: command.occurred_at
        }),
        { session: options.session }
      )
    }

    const notification = await this.refreshWindow(active._id, command.occurred_at, options.session)
    return { status: 'aggregate_updated', notification }
  }

  async removeActor(
    sourceKey: string,
    occurredAt: Date,
    options: AggregationOptions
  ): Promise<NotificationMutationResult> {
    const actor = await this.databaseService.notificationActors.findOne(
      { source_key: sourceKey },
      { sort: { created_at: -1 }, session: options.session }
    )
    if (!actor) return { status: 'suppressed', notification: null, reason: 'actor_edge_missing' }

    const notification = await this.databaseService.notifications.findOne(
      { _id: actor.notification_id, aggregation_active: true, invalidated_at: null },
      { session: options.session }
    )
    if (!notification) return { status: 'suppressed', notification: null, reason: 'active_window_missing' }

    const removed = await this.databaseService.notificationActors.deleteOne(
      { _id: actor._id, source_key: sourceKey },
      { session: options.session }
    )
    if (removed.deletedCount === 0) {
      return { status: 'suppressed', notification: null, reason: 'actor_edge_already_removed' }
    }

    const actorCount = await this.databaseService.notificationActors.countDocuments(
      { notification_id: notification._id },
      { session: options.session }
    )
    if (actorCount === 0) {
      const invalidated = await this.databaseService.notifications.findOneAndUpdate(
        { _id: notification._id, aggregation_active: true, invalidated_at: null },
        {
          $set: {
            sender_id: null,
            actor_ids_preview: [],
            actor_count: 0,
            aggregation_active: false,
            invalidated_at: occurredAt,
            updated_at: occurredAt
          }
        },
        { returnDocument: 'after', session: options.session }
      )
      if (!invalidated) throw new Error('Could not invalidate empty notification aggregate')
      const unreadState = !invalidated.is_read
        ? await this.unreadService.decrement(invalidated.recipient_id, 1, occurredAt, { session: options.session })
        : undefined
      return { status: 'aggregate_removed', notification: invalidated, unread_state: unreadState }
    }

    return {
      status: 'aggregate_updated',
      notification: await this.refreshWindow(notification._id, occurredAt, options.session)
    }
  }

  async removeActorFromNotification(
    notificationId: ObjectId,
    actorId: ObjectId,
    occurredAt: Date,
    options: AggregationOptions
  ): Promise<NotificationMutationResult> {
    const notification = await this.databaseService.notifications.findOne(
      { _id: notificationId, invalidated_at: null, aggregation_key: { $exists: true } },
      { session: options.session }
    )
    if (!notification) return { status: 'suppressed', notification: null, reason: 'aggregate_missing' }

    const removed = await this.databaseService.notificationActors.deleteOne(
      { notification_id: notificationId, actor_id: actorId },
      { session: options.session }
    )
    if (removed.deletedCount === 0) {
      return { status: 'suppressed', notification: null, reason: 'actor_edge_already_removed' }
    }

    const actorCount = await this.databaseService.notificationActors.countDocuments(
      { notification_id: notificationId },
      { session: options.session }
    )
    if (actorCount > 0) {
      return {
        status: 'aggregate_updated',
        notification: await this.refreshWindow(notificationId, occurredAt, options.session, false)
      }
    }

    const invalidated = await this.databaseService.notifications.findOneAndUpdate(
      { _id: notificationId, invalidated_at: null },
      {
        $set: {
          sender_id: null,
          actor_ids_preview: [],
          actor_count: 0,
          aggregation_active: false,
          invalidated_at: occurredAt,
          updated_at: occurredAt
        }
      },
      { returnDocument: 'after', session: options.session }
    )
    if (!invalidated) return { status: 'suppressed', notification: null, reason: 'aggregate_already_removed' }
    const unreadState = !invalidated.is_read
      ? await this.unreadService.decrement(invalidated.recipient_id, 1, occurredAt, { session: options.session })
      : undefined
    return { status: 'aggregate_removed', notification: invalidated, unread_state: unreadState }
  }

  private async createWindow(
    command: AggregateNotificationCommand,
    options: AggregationOptions
  ): Promise<NotificationMutationResult> {
    const notificationId = new ObjectId()
    const notification = new Notification({
      _id: notificationId,
      recipient_id: command.recipient_id,
      sender_id: command.actor_id,
      type: command.type,
      target_id: command.target_id,
      target_type: command.target_type,
      actor_ids_preview: [command.actor_id],
      actor_count: 1,
      context: command.context,
      deduplication_key: `${command.aggregation_key}:WINDOW:${notificationId.toHexString()}`,
      aggregation_key: command.aggregation_key,
      aggregation_active: true,
      read_at: null,
      unread_since: new Date(),
      created_at: command.occurred_at,
      updated_at: command.occurred_at,
      invalidated_at: null
    })
    await this.databaseService.notifications.insertOne(notification, { session: options.session })
    await this.databaseService.notificationActors.insertOne(
      new NotificationActor({
        notification_id: notificationId,
        actor_id: command.actor_id,
        source_key: command.source_key,
        last_event_id: command.event_id,
        context: command.context,
        created_at: command.occurred_at,
        updated_at: command.occurred_at
      }),
      { session: options.session }
    )
    const unreadState = await this.unreadService.increment(command.recipient_id, 1, command.occurred_at, {
      session: options.session
    })
    return {
      status: 'created',
      notification: { ...notification, _id: notificationId },
      unread_state: unreadState
    }
  }

  private async refreshWindow(
    notificationId: ObjectId,
    occurredAt: Date,
    session: ClientSession,
    activeOnly = true
  ): Promise<WithId<NotificationModel>> {
    const actorCount = await this.databaseService.notificationActors.countDocuments(
      { notification_id: notificationId },
      { session }
    )
    const preview = await this.databaseService.notificationActors
      .find({ notification_id: notificationId }, { projection: { actor_id: 1, context: 1 }, session })
      .sort({ updated_at: -1, _id: -1 })
      .limit(3)
      .toArray()
    const actorIds = preview.map((actor) => actor.actor_id)
    const notification = await this.databaseService.notifications.findOneAndUpdate(
      {
        _id: notificationId,
        invalidated_at: null,
        ...(activeOnly ? { aggregation_active: true } : {})
      },
      {
        $set: {
          sender_id: actorIds[0] ?? null,
          actor_ids_preview: actorIds,
          actor_count: actorCount,
          context: preview[0]?.context ?? {}
        },
        $max: { updated_at: occurredAt }
      },
      { returnDocument: 'after', session }
    )
    if (!notification) throw new Error('Could not refresh notification aggregate')
    return notification
  }
}
