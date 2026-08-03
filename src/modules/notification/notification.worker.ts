import { Worker, type Job } from 'bullmq'
import { connection } from '~/config/redisConfig'
import { OutboxRepository } from '~/modules/events/outbox.repository'
import {
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_QUEUE_NAME,
  type NotificationJobData,
  type NotificationJobResult
} from '~/queues/notification.queue'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationEventHandler } from './notification-event.handler'
import { countNotificationMutations, type NotificationEventHandlerResult } from './notification-event.type'
import { NotificationRepository } from './notification.repository'
import { NotificationPolicyService } from './notification-policy.service'
import { NotificationDeliveryService } from './notification-delivery.service'
import { NotificationAggregationService } from './notification-aggregation.service'
import { NotificationLifecycleService } from './notification-lifecycle.service'
import { envConfig } from '~/config/getEnvConfig'
import { DomainEventType, parseDomainEvent } from '~/modules/events/domain-event.type'
import { TweetAudience, TweetType } from '~/constants/enums'
import {
  createNotificationFanoutJobId,
  NOTIFICATION_FANOUT_JOB_NAME,
  notificationFanoutQueue
} from '~/queues/notification-fanout.queue'

const NOTIFICATION_WORKER_CONCURRENCY = 5
const WORKER_SHUTDOWN_TIMEOUT_MS = 10_000

export class NotificationWorker {
  private readonly worker: Worker<NotificationJobData, NotificationJobResult>
  private activeJobs = 0
  private readonly idleResolvers = new Set<() => void>()

  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly outboxRepository: OutboxRepository = new OutboxRepository(databaseService),
    private readonly eventHandler: NotificationEventHandler = new NotificationEventHandler(
      new NotificationRepository(databaseService),
      new NotificationPolicyService(databaseService),
      new NotificationDeliveryService(),
      new NotificationAggregationService(databaseService),
      new NotificationLifecycleService(
        databaseService,
        new NotificationRepository(databaseService),
        new NotificationAggregationService(databaseService)
      )
    )
  ) {
    this.worker = new Worker<NotificationJobData, NotificationJobResult>(
      NOTIFICATION_QUEUE_NAME,
      (job) => this.trackProcess(job),
      { connection, concurrency: NOTIFICATION_WORKER_CONCURRENCY }
    )
    this.worker.on('error', (error) => {
      console.error('Notification worker error', { error: error.message })
    })
  }

  async close(): Promise<void> {
    await this.worker.pause(true)
    let timeout: NodeJS.Timeout | undefined
    const drained = await Promise.race([
      this.waitForActiveJobs().then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false)
        }, WORKER_SHUTDOWN_TIMEOUT_MS)
      })
    ])
    if (timeout) clearTimeout(timeout)
    await this.worker.close(!drained)
  }

  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady()
  }

  private async trackProcess(job: Job<NotificationJobData, NotificationJobResult>): Promise<NotificationJobResult> {
    this.activeJobs += 1
    try {
      return await this.process(job)
    } finally {
      this.activeJobs -= 1
      if (this.activeJobs === 0) {
        for (const resolve of this.idleResolvers) resolve()
        this.idleResolvers.clear()
      }
    }
  }

  private waitForActiveJobs(): Promise<void> {
    if (this.activeJobs === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.add(resolve))
  }

  private async process(job: Job<NotificationJobData, NotificationJobResult>): Promise<NotificationJobResult> {
    const startedAt = Date.now()
    const attempt = job.attemptsMade + 1
    let handlerResult: NotificationEventHandlerResult | undefined
    let alreadyProcessed = false
    let eventType: string | undefined
    let fanoutEventId: string | undefined
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        const outboxEvent = await this.outboxRepository.findByEventId(job.data.event_id, { session })
        if (!outboxEvent) throw new Error(`Outbox event not found: ${job.data.event_id}`)
        eventType = outboxEvent.type
        if (
          envConfig.features.notificationFollowedTweetEnabled &&
          outboxEvent.type === DomainEventType.TweetCreated
        ) {
          const event = parseDomainEvent({
            event_id: outboxEvent.event_id,
            type: outboxEvent.type,
            aggregate_type: outboxEvent.aggregate_type,
            aggregate_id: outboxEvent.aggregate_id,
            actor_id: outboxEvent.actor_id,
            payload: outboxEvent.payload,
            occurred_at: outboxEvent.occurred_at
          })
          if (
            event.type === DomainEventType.TweetCreated &&
            event.payload.tweet_type === TweetType.Tweet &&
            event.payload.audience === TweetAudience.Everyone
          ) {
            fanoutEventId = event.event_id
          }
        }
        if (outboxEvent.status === 'processed') {
          alreadyProcessed = true
          return
        }
        if (outboxEvent.status === 'dead_letter') {
          throw new Error(`Outbox event is dead-lettered: ${job.data.event_id}`)
        }

        handlerResult = await this.eventHandler.handle(
          {
            event_id: outboxEvent.event_id,
            type: outboxEvent.type,
            aggregate_type: outboxEvent.aggregate_type,
            aggregate_id: outboxEvent.aggregate_id,
            actor_id: outboxEvent.actor_id,
            payload: outboxEvent.payload,
            occurred_at: outboxEvent.occurred_at
          },
          { session, deliver: false }
        )
        if (!fanoutEventId) {
          const marked = await this.outboxRepository.markProcessed(outboxEvent.event_id, new Date(), { session })
          if (!marked) throw new Error(`Could not mark outbox event processed: ${outboxEvent.event_id}`)
        }
      })

      if (handlerResult) this.eventHandler.deliverAfterCommit(handlerResult)
      if (fanoutEventId) {
        await notificationFanoutQueue.add(
          NOTIFICATION_FANOUT_JOB_NAME,
          { event_id: fanoutEventId },
          { jobId: createNotificationFanoutJobId(fanoutEventId) }
        )
        if (!alreadyProcessed) {
          const marked = await this.outboxRepository.markProcessed(fanoutEventId, new Date())
          if (!marked) throw new Error(`Could not mark fanout source event processed: ${fanoutEventId}`)
        }
      }
      const status = alreadyProcessed ? 'already_processed' : 'processed'
      console.info('notification_event_processed', {
        event_id: job.data.event_id,
        event_type: eventType,
        attempt,
        outcome: alreadyProcessed ? 'already_processed' : (handlerResult?.status ?? 'no_notification_intent'),
        mutation_count: countNotificationMutations(handlerResult),
        latency_ms: Date.now() - startedAt
      })
      return { event_id: job.data.event_id, status }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const deadLetter = attempt >= NOTIFICATION_JOB_ATTEMPTS
      await this.outboxRepository.recordProcessingFailure(job.data.event_id, message, deadLetter)
      console.error('notification_event_failed', {
        event_id: job.data.event_id,
        event_type: eventType,
        attempt,
        dead_letter: deadLetter,
        latency_ms: Date.now() - startedAt,
        error: message
      })
      throw error
    } finally {
      await session.endSession()
    }
  }
}
