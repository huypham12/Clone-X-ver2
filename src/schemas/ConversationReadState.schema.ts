import { ObjectId } from 'mongodb'

export type ConversationReadStateType = 'direct' | 'group'

interface ConversationReadStateConstructor {
  _id?: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationReadStateType
  user_id: ObjectId
  last_read_message_id?: ObjectId | null
  last_read_at?: Date | null
  unread_message_count?: number
  notification_relevance_version?: number
  created_at?: Date
  updated_at?: Date
}

export default class ConversationReadState {
  _id?: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationReadStateType
  user_id: ObjectId
  last_read_message_id: ObjectId | null
  last_read_at: Date | null
  unread_message_count: number
  notification_relevance_version: number
  created_at: Date
  updated_at: Date

  constructor(data: ConversationReadStateConstructor) {
    const now = new Date()
    this._id = data._id
    this.conversation_id = data.conversation_id
    this.conversation_type = data.conversation_type
    this.user_id = data.user_id
    this.last_read_message_id = data.last_read_message_id ?? null
    this.last_read_at = data.last_read_at ?? null
    this.unread_message_count = Math.max(0, data.unread_message_count ?? 0)
    this.notification_relevance_version = Math.max(0, data.notification_relevance_version ?? 0)
    this.created_at = data.created_at ?? now
    this.updated_at = data.updated_at ?? now
  }
}
