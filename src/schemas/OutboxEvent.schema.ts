import { ObjectId } from 'mongodb'

export type OutboxEventStatus = 'pending' | 'published' | 'processed' | 'dead_letter'
export type OutboxEventPayload = Record<string, unknown>

interface OutboxEventConstructor {
  _id?: ObjectId
  event_id: string
  type: string
  aggregate_type: string
  aggregate_id: ObjectId
  actor_id: ObjectId | null
  payload: OutboxEventPayload
  occurred_at: Date
  status?: OutboxEventStatus
  attempts?: number
  available_at?: Date
  locked_at?: Date | null
  locked_by?: string | null
  last_error?: string | null
  created_at?: Date
  updated_at?: Date
}

export default class OutboxEvent {
  _id?: ObjectId
  event_id: string
  type: string
  aggregate_type: string
  aggregate_id: ObjectId
  actor_id: ObjectId | null
  payload: OutboxEventPayload
  occurred_at: Date
  status: OutboxEventStatus
  attempts: number
  available_at: Date
  locked_at: Date | null
  locked_by: string | null
  last_error: string | null
  created_at: Date
  updated_at: Date

  constructor(event: OutboxEventConstructor) {
    const now = new Date()
    this._id = event._id ?? new ObjectId()
    this.event_id = event.event_id
    this.type = event.type
    this.aggregate_type = event.aggregate_type
    this.aggregate_id = event.aggregate_id
    this.actor_id = event.actor_id
    this.payload = event.payload
    this.occurred_at = event.occurred_at
    this.status = event.status ?? 'pending'
    this.attempts = event.attempts ?? 0
    this.available_at = event.available_at ?? event.occurred_at
    this.locked_at = event.locked_at ?? null
    this.locked_by = event.locked_by ?? null
    this.last_error = event.last_error ?? null
    this.created_at = event.created_at ?? now
    this.updated_at = event.updated_at ?? now
  }
}
