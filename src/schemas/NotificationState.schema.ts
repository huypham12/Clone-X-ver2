import { ObjectId } from 'mongodb'

interface NotificationStateConstructor {
  _id?: ObjectId
  recipient_id: ObjectId
  unread_count?: number
  version?: number
  updated_at?: Date
}

export default class NotificationState {
  _id: ObjectId
  recipient_id: ObjectId
  unread_count: number
  version: number
  updated_at: Date

  constructor({ _id, recipient_id, unread_count = 0, version = 0, updated_at }: NotificationStateConstructor) {
    this._id = _id ?? new ObjectId()
    this.recipient_id = recipient_id
    this.unread_count = Math.max(0, unread_count)
    this.version = Math.max(0, version)
    this.updated_at = updated_at ?? new Date()
  }
}
