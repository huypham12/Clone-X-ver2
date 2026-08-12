import type { ClientSession, Filter, ObjectId } from 'mongodb'
import { NotificationTargetType } from '~/constants/enums'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import type {
  MessageDeletedForRecipientEvent,
  MessageRevokedDomainEvent,
  TweetDeletedEvent,
  TweetMentionsChangedEvent,
  UserBlockedEvent,
  UserUnblockedEvent
} from '~/modules/events/domain-event.type'
import { OutboxDomainEventPublisher } from '~/modules/events/outbox.publisher'
import type Notification from '~/schemas/Notification.schema'
import { NotificationAggregationService } from './notification-aggregation.service'
import type { NotificationEventHandlerResult, NotificationMutationResult } from './notification-event.type'
import { NotificationRepository } from './notification.repository'

const LIFECYCLE_PAGE_SIZE = 500
type BlockCleanupStage = 'individual' | 'aggregate_blocker' | 'aggregate_blocked'

export class NotificationLifecycleService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly repository: NotificationRepository = new NotificationRepository(databaseService),
    private readonly aggregationService: NotificationAggregationService = new NotificationAggregationService(
      databaseService
    ),
    private readonly outboxPublisher: OutboxDomainEventPublisher = new OutboxDomainEventPublisher()
  ) {}

  async handleTweetDeleted(event: TweetDeletedEvent, session: ClientSession): Promise<NotificationEventHandlerResult> {
    const page = await this.invalidateTargetPage(
      event.payload.tweet_id,
      event.occurred_at,
      event.payload.cleanup_cursor ?? null,
      session
    )
    if (page.next_cursor) {
      await this.publishTweetDeletedContinuation(event, 'target', page.next_cursor, session)
    } else {
      page.results.push(
        ...(await this.removeAggregateEdgesBySource(`RETWEET:${event.payload.source_id}`, event.occurred_at, session))
      )
    }
    return this.toResult(page.results, 'tweet_target_already_absent')
  }

  async handleTweetVisibilityRevoked(
    event: TweetMentionsChangedEvent,
    session: ClientSession
  ): Promise<NotificationEventHandlerResult> {
    const page = await this.invalidateTargetPage(
      event.payload.tweet_id,
      event.occurred_at,
      event.payload.cleanup_cursor ?? null,
      session
    )
    if (page.next_cursor) {
      await this.publishTweetVisibilityContinuation(event, 'target', page.next_cursor, session)
    }
    return this.toResult(page.results, 'tweet_visibility_cleanup_already_applied')
  }

  async handleMessageRevoked(
    event: MessageRevokedDomainEvent,
    session: ClientSession
  ): Promise<NotificationEventHandlerResult> {
    const page = await this.repository.invalidateMatchingPage(
      {
        target_type: NotificationTargetType.Message,
        target_id: event.payload.message_id,
        created_at: { $lte: event.occurred_at }
      },
      event.occurred_at,
      event.payload.cleanup_cursor ?? null,
      { session, batch_size: LIFECYCLE_PAGE_SIZE }
    )
    await this.removeEdgesForInvalidated(page.results, session)
    if (page.next_cursor) await this.publishMessageRevokedContinuation(event, page.next_cursor, session)
    return this.toResult(page.results, 'message_target_already_absent')
  }

  async handleMessageDeletedForRecipient(
    event: MessageDeletedForRecipientEvent,
    session: ClientSession
  ): Promise<NotificationEventHandlerResult> {
    const page = await this.repository.invalidateMatchingPage(
      {
        recipient_id: event.payload.recipient_id,
        target_type: NotificationTargetType.Message,
        target_id: event.payload.message_id,
        created_at: { $lte: event.occurred_at }
      },
      event.occurred_at,
      event.payload.cleanup_cursor ?? null,
      { session, batch_size: LIFECYCLE_PAGE_SIZE }
    )
    await this.removeEdgesForInvalidated(page.results, session)
    if (page.next_cursor) await this.publishMessageDeletedContinuation(event, page.next_cursor, session)
    return this.toResult(page.results, 'recipient_message_target_already_absent')
  }

  async handleUserBlocked(event: UserBlockedEvent, session: ClientSession): Promise<NotificationEventHandlerResult> {
    const stage = this.parseBlockStage(event.payload.cleanup_stage)
    if (stage === 'individual') {
      const filter: Filter<Notification> = {
        aggregation_key: { $exists: false },
        created_at: { $lte: event.occurred_at },
        $or: [
          { recipient_id: event.payload.blocker_id, sender_id: event.payload.blocked_user_id },
          { recipient_id: event.payload.blocked_user_id, sender_id: event.payload.blocker_id }
        ]
      }
      const page = await this.repository.invalidateMatchingPage(
        filter,
        event.occurred_at,
        event.payload.cleanup_cursor ?? null,
        { session, batch_size: LIFECYCLE_PAGE_SIZE }
      )
      if (page.next_cursor) {
        await this.publishBlockContinuation(event, stage, page.next_cursor, session)
      } else {
        await this.publishBlockContinuation(event, 'aggregate_blocker', null, session)
      }
      return this.toResult(page.results, 'block_individual_cleanup_already_applied')
    }

    const actorId = stage === 'aggregate_blocker' ? event.payload.blocked_user_id : event.payload.blocker_id
    const recipientId = stage === 'aggregate_blocker' ? event.payload.blocker_id : event.payload.blocked_user_id
    const page = await this.removeActorFromRecipientAggregatesPage(
      actorId,
      recipientId,
      event.occurred_at,
      event.payload.cleanup_cursor ?? null,
      session
    )
    if (page.next_cursor) {
      await this.publishBlockContinuation(event, stage, page.next_cursor, session)
    } else if (stage === 'aggregate_blocker') {
      await this.publishBlockContinuation(event, 'aggregate_blocked', null, session)
    }
    return this.toResult(page.results, 'block_aggregate_cleanup_already_applied')
  }

  handleUserUnblocked(_event: UserUnblockedEvent): NotificationEventHandlerResult {
    return { status: 'suppressed', notification: null, reason: 'unblock_does_not_restore_notifications' }
  }

  private async invalidateTargetPage(
    tweetId: ObjectId,
    occurredAt: Date,
    cursor: ObjectId | null,
    session: ClientSession
  ) {
    const page = await this.repository.invalidateMatchingPage(
      {
        target_type: NotificationTargetType.Tweet,
        created_at: { $lte: occurredAt },
        $or: [{ target_id: tweetId }, { 'context.parent_tweet_id': tweetId }]
      },
      occurredAt,
      cursor,
      { session, batch_size: LIFECYCLE_PAGE_SIZE }
    )
    await this.removeEdgesForInvalidated(page.results, session)
    return page
  }

  private async removeActorFromRecipientAggregatesPage(
    actorId: ObjectId,
    recipientId: ObjectId,
    occurredAt: Date,
    cursor: ObjectId | null,
    session: ClientSession
  ): Promise<{ results: NotificationMutationResult[]; next_cursor: ObjectId | null }> {
    const page = await this.databaseService.notifications
      .find(
        {
          recipient_id: recipientId,
          aggregation_key: { $exists: true },
          invalidated_at: null,
          created_at: { $lte: occurredAt },
          ...(cursor ? { _id: { $gt: cursor } } : {})
        },
        { projection: { _id: 1 }, session }
      )
      .sort({ _id: 1 })
      .limit(LIFECYCLE_PAGE_SIZE + 1)
      .toArray()
    const selected = page.slice(0, LIFECYCLE_PAGE_SIZE)
    const actorEdges = await this.databaseService.notificationActors
      .find(
        {
          notification_id: { $in: selected.map((item) => item._id) },
          actor_id: actorId,
          created_at: { $lte: occurredAt }
        },
        { projection: { notification_id: 1 }, session }
      )
      .toArray()
    const results: NotificationMutationResult[] = []
    for (const edge of actorEdges) {
      results.push(
        await this.aggregationService.removeActorFromNotification(edge.notification_id, actorId, occurredAt, {
          session
        })
      )
    }
    return {
      results,
      next_cursor: page.length > LIFECYCLE_PAGE_SIZE && selected.length > 0 ? selected[selected.length - 1]._id : null
    }
  }

  private async removeAggregateEdgesBySource(
    sourceKey: string,
    occurredAt: Date,
    session: ClientSession
  ): Promise<NotificationMutationResult[]> {
    const edges = await this.databaseService.notificationActors
      .find({ source_key: sourceKey }, { projection: { notification_id: 1, actor_id: 1 }, session })
      .toArray()
    const results: NotificationMutationResult[] = []
    for (const edge of edges) {
      results.push(
        await this.aggregationService.removeActorFromNotification(edge.notification_id, edge.actor_id, occurredAt, {
          session
        })
      )
    }
    return results
  }

  private async removeEdgesForInvalidated(
    results: NotificationMutationResult[],
    session: ClientSession
  ): Promise<void> {
    const ids = results.flatMap((result) =>
      result.status === 'invalidated' || result.status === 'aggregate_removed' ? [result.notification._id] : []
    )
    if (ids.length > 0) {
      await this.databaseService.notificationActors.deleteMany({ notification_id: { $in: ids } }, { session })
    }
  }

  private async publishTweetDeletedContinuation(
    event: TweetDeletedEvent,
    stage: string,
    cursor: ObjectId,
    session: ClientSession
  ): Promise<void> {
    const root = event.payload.cleanup_root_event_id ?? event.event_id
    await this.outboxPublisher.publish(
      {
        ...event,
        event_id: this.continuationId(root, stage, cursor),
        payload: { ...event.payload, cleanup_root_event_id: root, cleanup_stage: stage, cleanup_cursor: cursor }
      },
      { session }
    )
  }

  private async publishTweetVisibilityContinuation(
    event: TweetMentionsChangedEvent,
    stage: string,
    cursor: ObjectId,
    session: ClientSession
  ): Promise<void> {
    const root = event.payload.cleanup_root_event_id ?? event.event_id
    await this.outboxPublisher.publish(
      {
        ...event,
        event_id: this.continuationId(root, stage, cursor),
        payload: { ...event.payload, cleanup_root_event_id: root, cleanup_stage: stage, cleanup_cursor: cursor }
      },
      { session }
    )
  }

  private async publishMessageRevokedContinuation(
    event: MessageRevokedDomainEvent,
    cursor: ObjectId,
    session: ClientSession
  ): Promise<void> {
    const root = event.payload.cleanup_root_event_id ?? event.event_id
    await this.outboxPublisher.publish(
      {
        ...event,
        event_id: this.continuationId(root, 'target', cursor),
        payload: { ...event.payload, cleanup_root_event_id: root, cleanup_stage: 'target', cleanup_cursor: cursor }
      },
      { session }
    )
  }

  private async publishMessageDeletedContinuation(
    event: MessageDeletedForRecipientEvent,
    cursor: ObjectId,
    session: ClientSession
  ): Promise<void> {
    const root = event.payload.cleanup_root_event_id ?? event.event_id
    await this.outboxPublisher.publish(
      {
        ...event,
        event_id: this.continuationId(root, 'target', cursor),
        payload: { ...event.payload, cleanup_root_event_id: root, cleanup_stage: 'target', cleanup_cursor: cursor }
      },
      { session }
    )
  }

  private async publishBlockContinuation(
    event: UserBlockedEvent,
    stage: BlockCleanupStage,
    cursor: ObjectId | null,
    session: ClientSession
  ): Promise<void> {
    const root = event.payload.cleanup_root_event_id ?? event.event_id
    await this.outboxPublisher.publish(
      {
        ...event,
        event_id: this.continuationId(root, stage, cursor),
        payload: {
          ...event.payload,
          cleanup_root_event_id: root,
          cleanup_stage: stage,
          ...(cursor ? { cleanup_cursor: cursor } : { cleanup_cursor: undefined })
        }
      },
      { session }
    )
  }

  private continuationId(root: string, stage: string, cursor: ObjectId | null): string {
    return `${root}--cleanup--${stage}--${cursor?.toHexString() ?? 'start'}`
  }

  private parseBlockStage(stage: string | undefined): BlockCleanupStage {
    if (stage === undefined || stage === 'individual') return 'individual'
    if (stage === 'aggregate_blocker' || stage === 'aggregate_blocked') return stage
    throw new Error(`Invalid block cleanup stage: ${stage}`)
  }

  private toResult(results: NotificationMutationResult[], reason: string): NotificationEventHandlerResult {
    return results.length > 0 ? { status: 'batch', results } : { status: 'suppressed', notification: null, reason }
  }
}
