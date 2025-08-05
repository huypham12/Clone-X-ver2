import { ObjectId } from 'mongodb'

type MessagePreview = {
  sender_id: ObjectId
  content: string
  message_type: 'text' | 'image' | 'video' | 'file'
}

type DirectConversationType = {
  _id?: ObjectId
  user1_id: ObjectId // user1_id < user2_id
  user2_id: ObjectId
  last_message_at: Date
  last_message_preview: MessagePreview
  created_at?: Date
  updated_at?: Date
}

export default class DirectConversation {
  _id?: ObjectId
  user1_id: ObjectId // user1_id < user2_id
  user2_id: ObjectId
  last_message_at: Date
  last_message_preview: MessagePreview
  created_at?: Date
  updated_at?: Date
  constructor(data: DirectConversationType) {
    this._id = data._id
    this.user1_id = data.user1_id
    this.user2_id = data.user2_id
    this.last_message_at = data.last_message_at
    this.last_message_preview = data.last_message_preview
    this.created_at = data.created_at || new Date()
    this.updated_at = data.updated_at || new Date()
  }
}
