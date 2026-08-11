import { ObjectId } from 'mongodb'

interface UserMessageStateConstructor {
  _id?: ObjectId
  user_id: ObjectId
  unread_conversation_count?: number
  total_unread_message_count?: number
  version?: number
  updated_at?: Date
}

export default class UserMessageState {
  _id?: ObjectId
  user_id: ObjectId
  unread_conversation_count: number
  total_unread_message_count: number
  version: number
  updated_at: Date

  constructor(data: UserMessageStateConstructor) {
    this._id = data._id
    this.user_id = data.user_id
    this.unread_conversation_count = Math.max(0, data.unread_conversation_count ?? 0)
    this.total_unread_message_count = Math.max(0, data.total_unread_message_count ?? 0)
    this.version = Math.max(0, data.version ?? 0)
    this.updated_at = data.updated_at ?? new Date()
  }
}
