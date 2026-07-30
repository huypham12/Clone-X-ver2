import { randomUUID } from 'crypto'
import type {
  TransactionalDomainEventPublisher,
  TransactionalDomainEventPublishOptions
} from './domain-event.publisher'
import type { DomainEvent } from './domain-event.type'
import { OutboxRepository, type OutboxInsertResult } from './outbox.repository'
import {
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_NAME,
  notificationQueue
} from '~/queues/notification.queue'

const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_LEASE_MS = 30_000
const ENQUEUE_RETRY_DELAY_MS = 5_000
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_RECONCILE_AFTER_MS = 60_000
const DEFAULT_RECONCILE_BATCH_SIZE = 50
const PUBLISHER_SHUTDOWN_TIMEOUT_MS = 10_000

export class OutboxDomainEventPublisher implements TransactionalDomainEventPublisher<OutboxInsertResult> {
  constructor(private readonly repository: OutboxRepository = new OutboxRepository()) {}

  publish(event: DomainEvent, options: TransactionalDomainEventPublishOptions): Promise<OutboxInsertResult> {
    return this.repository.insert(event, options)
  }
}

export class OutboxQueuePublisher {
  private readonly lockedBy = `notification-publisher:${process.pid}:${randomUUID()}`
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<void> | undefined
  private stopping = false

  constructor(
    private readonly repository: OutboxRepository = new OutboxRepository(),
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    private readonly leaseMs = DEFAULT_LEASE_MS,
    private readonly queue: Pick<typeof notificationQueue, 'add' | 'getJob'> = notificationQueue
  ) {}

  start(): void {
    if (this.timer || this.inFlight) return
    this.stopping = false
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.inFlight) {
      const completed = await this.waitWithin(this.inFlight, PUBLISHER_SHUTDOWN_TIMEOUT_MS)
      if (!completed) console.warn('Notification outbox publisher stop timed out; releasing leases')
    }
    const released = await this.waitWithin(
      this.repository.releaseLeases(this.lockedBy),
      PUBLISHER_SHUTDOWN_TIMEOUT_MS
    )
    if (!released) console.warn('Notification outbox publisher lease release timed out; leases will expire naturally')
  }

  async publishAvailable(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    await this.reconcilePublished()
    let published = 0
    for (let index = 0; index < batchSize && !this.stopping; index += 1) {
      const now = new Date()
      const event = await this.repository.claimNext(this.lockedBy, now, this.leaseMs)
      if (!event) break
      if (await this.enqueueClaimed(event.event_id)) published += 1
    }
    return published
  }

  async reconcilePublished(batchSize = DEFAULT_RECONCILE_BATCH_SIZE): Promise<number> {
    const staleBefore = new Date(Date.now() - DEFAULT_RECONCILE_AFTER_MS)
    const events = await this.repository.findPublishedBefore(staleBefore, batchSize)
    let reconciled = 0

    for (const event of events) {
      const job = await this.queue.getJob(event.event_id)
      if (!job) {
        if (await this.repository.requeuePublished(event.event_id, 'BullMQ job missing; scheduled for redelivery')) {
          reconciled += 1
        }
        continue
      }

      const state = await job.getState()
      if (state === 'failed') {
        const attempts = Math.max(event.attempts, job.attemptsMade, NOTIFICATION_JOB_ATTEMPTS)
        const error = job.failedReason || 'BullMQ job exhausted retries'
        if (await this.repository.markDeadLetterFromQueue(event.event_id, attempts, error)) reconciled += 1
        continue
      }

      if (state === 'completed' || state === 'unknown') {
        await job.remove()
        if (
          await this.repository.requeuePublished(
            event.event_id,
            `BullMQ job is ${state} while outbox is still published; scheduled for idempotent redelivery`
          )
        ) {
          reconciled += 1
        }
      }
    }

    return reconciled
  }

  async replay(eventId: string): Promise<boolean> {
    const job = await this.queue.getJob(eventId)
    if (job) {
      const state = await job.getState()
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        throw new Error(`Cannot replay active notification job ${eventId}`)
      }
      await job.remove()
    }
    const claimed = await this.repository.claimDeadLetterForReplay(eventId, this.lockedBy, new Date())
    if (claimed && !(await this.enqueueClaimed(eventId))) {
      throw new Error(`Could not enqueue replayed notification event ${eventId}`)
    }
    return claimed !== null
  }

  private async enqueueClaimed(eventId: string): Promise<boolean> {
    try {
      await this.queue.add(NOTIFICATION_JOB_NAME, { event_id: eventId }, { jobId: eventId })
      await this.repository.markPublished(eventId, this.lockedBy, new Date())
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      await this.repository.releaseLease(
        eventId,
        this.lockedBy,
        new Date(Date.now() + ENQUEUE_RETRY_DELAY_MS),
        message
      )
      return false
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.inFlight = this.publishAvailable()
        .then(() => undefined)
        .catch((error: unknown) => {
          console.error('Notification outbox publisher iteration failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        })
        .finally(() => {
          this.inFlight = undefined
          this.schedule(this.pollIntervalMs)
        })
    }, delayMs)
  }

  private async waitWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise.then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
