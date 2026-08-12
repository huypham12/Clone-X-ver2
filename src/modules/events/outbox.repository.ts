import type { ClientSession, ObjectId, WithId } from 'mongodb'
import { isDeepStrictEqual } from 'util'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import type { DomainEvent } from './domain-event.type'
import { OutboxEvent } from '~/schemas'
import type { OutboxEventStatus } from '~/schemas/OutboxEvent.schema'

export interface OutboxRepositoryOptions {
  session?: ClientSession
}

export interface OutboxInsertOptions {
  session: ClientSession
}

export type OutboxInsertResult =
  | { status: 'created'; event: WithId<OutboxEvent> }
  | { status: 'existing'; event: WithId<OutboxEvent> }

export class OutboxRepository {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async insert(event: DomainEvent, options: OutboxInsertOptions): Promise<OutboxInsertResult> {
    if (!options.session.inTransaction()) {
      throw new Error('Outbox event must be inserted inside an active MongoDB transaction')
    }
    const outboxEvent = new OutboxEvent({
      event_id: event.event_id,
      type: event.type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      actor_id: event.actor_id,
      payload: event.payload,
      occurred_at: event.occurred_at
    })
    const result = await this.databaseService.outboxEvents.findOneAndUpdate(
      { event_id: event.event_id },
      { $setOnInsert: outboxEvent },
      {
        upsert: true,
        returnDocument: 'after',
        includeResultMetadata: true,
        session: options.session
      }
    )
    if (!result.value) throw new Error('Outbox upsert returned no document')
    this.assertEventIdentity(result.value, event)
    return {
      status: result.lastErrorObject?.upserted !== undefined ? 'created' : 'existing',
      event: result.value
    }
  }

  async claimNext(lockedBy: string, now: Date, leaseMs: number): Promise<WithId<OutboxEvent> | null> {
    const leaseExpiredAt = new Date(now.getTime() - leaseMs)
    return this.databaseService.outboxEvents.findOneAndUpdate(
      {
        status: 'pending',
        available_at: { $lte: now },
        $or: [{ locked_at: null }, { locked_at: { $lte: leaseExpiredAt } }]
      },
      { $set: { locked_at: now, locked_by: lockedBy, updated_at: now } },
      { sort: { available_at: 1, occurred_at: 1, _id: 1 }, returnDocument: 'after' }
    )
  }

  async markPublished(eventId: string, lockedBy: string, now: Date): Promise<boolean> {
    const result = await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: 'pending', locked_by: lockedBy },
      {
        $set: {
          status: 'published',
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: now
        }
      }
    )
    return result.modifiedCount > 0
  }

  async releaseLease(eventId: string, lockedBy: string, availableAt: Date, error: string): Promise<void> {
    await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: 'pending', locked_by: lockedBy },
      {
        $set: {
          locked_at: null,
          locked_by: null,
          available_at: availableAt,
          last_error: error,
          updated_at: new Date()
        }
      }
    )
  }

  async releaseLeases(lockedBy: string): Promise<void> {
    const now = new Date()
    await this.databaseService.outboxEvents.updateMany(
      { status: 'pending', locked_by: lockedBy },
      { $set: { locked_at: null, locked_by: null, available_at: now, updated_at: now } }
    )
  }

  async findByEventId(eventId: string, options: OutboxRepositoryOptions = {}): Promise<WithId<OutboxEvent> | null> {
    return this.databaseService.outboxEvents.findOne({ event_id: eventId }, { session: options.session })
  }

  async findPublishedBefore(staleBefore: Date, limit: number): Promise<WithId<OutboxEvent>[]> {
    return this.databaseService.outboxEvents
      .find({ status: 'published', updated_at: { $lte: staleBefore } })
      .sort({ updated_at: 1, _id: 1 })
      .limit(limit)
      .toArray()
  }

  async markProcessed(eventId: string, now: Date, options: OutboxRepositoryOptions = {}): Promise<boolean> {
    const result = await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: { $ne: 'dead_letter' } },
      {
        $set: {
          status: 'processed',
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: now
        }
      },
      { session: options.session }
    )
    return result.matchedCount > 0
  }

  async recordProcessingFailure(eventId: string, error: string, deadLetter: boolean): Promise<void> {
    const status: OutboxEventStatus = deadLetter ? 'dead_letter' : 'published'
    await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: { $ne: 'processed' } },
      {
        $inc: { attempts: 1 },
        $set: {
          status,
          locked_at: null,
          locked_by: null,
          last_error: error,
          updated_at: new Date()
        }
      }
    )
  }

  async markDeadLetterFromQueue(eventId: string, attempts: number, error: string): Promise<boolean> {
    const now = new Date()
    const result = await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: 'published' },
      {
        $max: { attempts },
        $set: {
          status: 'dead_letter',
          locked_at: null,
          locked_by: null,
          last_error: error,
          updated_at: now
        }
      }
    )
    return result.modifiedCount > 0
  }

  async requeuePublished(eventId: string, error: string): Promise<boolean> {
    const now = new Date()
    const result = await this.databaseService.outboxEvents.updateOne(
      { event_id: eventId, status: 'published' },
      {
        $set: {
          status: 'pending',
          available_at: now,
          locked_at: null,
          locked_by: null,
          last_error: error,
          updated_at: now
        }
      }
    )
    return result.modifiedCount > 0
  }

  async claimDeadLetterForReplay(eventId: string, lockedBy: string, now: Date): Promise<WithId<OutboxEvent> | null> {
    return this.databaseService.outboxEvents.findOneAndUpdate(
      { event_id: eventId, status: 'dead_letter' },
      {
        $set: {
          status: 'pending',
          attempts: 0,
          available_at: now,
          locked_at: now,
          locked_by: lockedBy,
          last_error: null,
          updated_at: now
        }
      },
      { returnDocument: 'after' }
    )
  }

  private assertEventIdentity(outboxEvent: WithId<OutboxEvent>, event: DomainEvent): void {
    const sameActor =
      (outboxEvent.actor_id === null && event.actor_id === null) ||
      outboxEvent.actor_id?.equals(event.actor_id) === true
    if (
      outboxEvent.type !== event.type ||
      outboxEvent.aggregate_type !== event.aggregate_type ||
      !outboxEvent.aggregate_id.equals(event.aggregate_id) ||
      !sameActor ||
      outboxEvent.occurred_at.getTime() !== event.occurred_at.getTime() ||
      !isDeepStrictEqual(outboxEvent.payload, event.payload)
    ) {
      throw new Error(`Outbox event_id collision: ${event.event_id}`)
    }
  }
}
