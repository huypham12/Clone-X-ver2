import { ObjectId } from 'mongodb'
import type { NotificationContext } from './Notification.schema'

interface NotificationActorConstructor {
  _id?: ObjectId
  notification_id: ObjectId
  actor_id: ObjectId
  source_key: string
  last_event_id: string
  context?: NotificationContext
  created_at?: Date
  updated_at?: Date
}

export default class NotificationActor {
  _id: ObjectId
  notification_id: ObjectId
  actor_id: ObjectId
  source_key: string
  last_event_id: string
  context: NotificationContext
  created_at: Date
  updated_at: Date

  constructor({
    _id,
    notification_id,
    actor_id,
    source_key,
    last_event_id,
    context = {},
    created_at,
    updated_at
  }: NotificationActorConstructor) {
    const now = new Date()
    this._id = _id ?? new ObjectId()
    this.notification_id = notification_id
    this.actor_id = actor_id
    this.source_key = source_key
    this.last_event_id = last_event_id
    this.context = context
    this.created_at = created_at ?? now
    this.updated_at = updated_at ?? now
  }
}
