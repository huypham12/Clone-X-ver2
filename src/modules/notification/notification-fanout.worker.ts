import { Worker, type Job } from 'bullmq'
import { ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { connection } from '~/config/redisConfig'
import { DomainEventType, parseDomainEvent, type TweetCreatedEvent } from '~/modules/events/domain-event.type'
import { OutboxRepository } from '~/modules/events/outbox.repository'
import {
  createNotificationFanoutJobId,
  NOTIFICATION_FANOUT_BATCH_SIZE,
  NOTIFICATION_FANOUT_JOB_NAME,
  NOTIFICATION_FANOUT_QUEUE_NAME,
  notificationFanoutQueue,
  type NotificationFanoutJobData,
  type NotificationFanoutJobResult
} from '~/queues/notification-fanout.queue'
import { NotificationAggregationService } from './notification-aggregation.service'
import { NotificationDeliveryService } from './notification-delivery.service'
import { NotificationEventHandler } from './notification-event.handler'
import { countNotificationMutations, type NotificationEventHandlerResult } from './notification-event.type'
import { NotificationPolicyService } from './notification-policy.service'
import { NotificationRepository } from './notification.repository'

const NOTIFICATION_FANOUT_WORKER_CONCURRENCY = 5

export class NotificationFanoutWorker {
  private readonly worker: Worker<NotificationFanoutJobData, NotificationFanoutJobResult>

  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly outboxRepository: OutboxRepository = new OutboxRepository(databaseService),
    private readonly eventHandler: NotificationEventHandler = new NotificationEventHandler(
      new NotificationRepository(databaseService),
      new NotificationPolicyService(databaseService),
      new NotificationDeliveryService(),
      new NotificationAggregationService(databaseService)
    )
  ) {
    this.worker = new Worker<NotificationFanoutJobData, NotificationFanoutJobResult>(
      NOTIFICATION_FANOUT_QUEUE_NAME,
      (job) => this.process(job),
      { connection, concurrency: NOTIFICATION_FANOUT_WORKER_CONCURRENCY }
    )
    this.worker.on('error', (error) => {
      console.error('Notification fanout worker error', { error: error.message })
    })
  }

  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady()
  }

  close(): Promise<void> {
    return this.worker.close()
  }

  private async process(
    job: Job<NotificationFanoutJobData, NotificationFanoutJobResult>
  ): Promise<NotificationFanoutJobResult> {
    const startedAt = Date.now()
    const attempt = job.attemptsMade + 1
    const session = this.databaseService.startSession()
    let handlerResult: NotificationEventHandlerResult | undefined
    let processedRecipients = 0
    let continuationEnqueued = false
    let continuationCursor: string | undefined
    try {
      await session.withTransaction(async () => {
        continuationCursor = undefined
        const stored = await this.outboxRepository.findByEventId(job.data.event_id, { session })
        if (!stored) throw new Error(`Fanout source event not found: ${job.data.event_id}`)
        if (stored.status !== 'processed') {
          throw new Error(`Fanout source event is not processed yet: ${job.data.event_id}`)
        }
        const parsed = parseDomainEvent({
          event_id: stored.event_id,
          type: stored.type,
          aggregate_type: stored.aggregate_type,
          aggregate_id: stored.aggregate_id,
          actor_id: stored.actor_id,
          payload: stored.payload,
          occurred_at: stored.occurred_at
        })
        if (parsed.type !== DomainEventType.TweetCreated) {
          throw new Error(`Fanout source must be TweetCreated: ${job.data.event_id}`)
        }
        const event: TweetCreatedEvent = parsed
        const afterRelationId = job.data.after_relation_id
          ? new ObjectId(job.data.after_relation_id)
          : undefined
        const relations = await this.databaseService.followers
          .find(
            {
              followed_user_id: event.actor_id,
              post_notifications_enabled: true,
              ...(afterRelationId ? { _id: { $gt: afterRelationId } } : {})
            },
            { projection: { _id: 1, follow_user_id: 1 }, session }
          )
          .sort({ _id: 1 })
          .limit(NOTIFICATION_FANOUT_BATCH_SIZE + 1)
          .toArray()
        const batch = relations.slice(0, NOTIFICATION_FANOUT_BATCH_SIZE)
        processedRecipients = batch.length
        if (batch.length > 0) {
          const guardedRelations = await this.databaseService.followers.updateMany(
            {
              _id: { $in: batch.map((relation) => relation._id) },
              followed_user_id: event.actor_id,
              post_notifications_enabled: true
            },
            { $set: { post_notifications_enabled: true } },
            { session }
          )
          if (guardedRelations.matchedCount !== batch.length) {
            throw new Error('Fanout relation set changed while processing the batch')
          }
        }
        handlerResult = await this.eventHandler.handleFollowedUserTweetBatch(
          event,
          batch.map((relation) => relation.follow_user_id),
          { session, deliver: false }
        )

        if (relations.length > NOTIFICATION_FANOUT_BATCH_SIZE) {
          const cursor = batch.at(-1)?._id.toHexString()
          if (!cursor) throw new Error('Fanout continuation cursor is missing')
          continuationCursor = cursor
        }
      })
      if (handlerResult) this.eventHandler.deliverAfterCommit(handlerResult)
      if (continuationCursor) {
        await notificationFanoutQueue.add(
          NOTIFICATION_FANOUT_JOB_NAME,
          { event_id: job.data.event_id, after_relation_id: continuationCursor },
          { jobId: createNotificationFanoutJobId(job.data.event_id, continuationCursor) }
        )
        continuationEnqueued = true
      }
      const result = {
        event_id: job.data.event_id,
        processed_recipients: processedRecipients,
        continuation_enqueued: continuationEnqueued
      }
      console.info('notification_fanout_batch_processed', {
        event_id: job.data.event_id,
        event_type: DomainEventType.TweetCreated,
        attempt,
        processed_recipients: processedRecipients,
        continuation_enqueued: continuationEnqueued,
        mutation_count: countNotificationMutations(handlerResult),
        latency_ms: Date.now() - startedAt
      })
      return result
    } catch (error: unknown) {
      console.error('notification_fanout_batch_failed', {
        event_id: job.data.event_id,
        event_type: DomainEventType.TweetCreated,
        attempt,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      await session.endSession()
    }
  }
}
