import { ObjectId } from 'mongodb'

type MessagePreview = {
  message_id?: ObjectId
  sender_id: ObjectId
  content: string
  message_type: 'text' | 'image' | 'video' | 'audio' | 'file'
}

type LastMessageOverride = {
  user_id: ObjectId
  message_id?: ObjectId
  last_message_at: Date
  last_message_preview: MessagePreview
}

export type HistoryClearMarker = {
  user_id: ObjectId
  cleared_at: Date
  cleared_through_message_id: ObjectId | null
  restore_on_next_message?: boolean
}

type DirectConversationType = {
  _id?: ObjectId
  user1_id: ObjectId // user1_id < user2_id
  user2_id: ObjectId
  last_message_at: Date
  last_message_preview: MessagePreview
  last_message_overrides?: LastMessageOverride[]
  hidden_by?: ObjectId[] // users who have deleted/hidden this conversation
  pinned_by?: ObjectId[] // users who pinned this conversation
  muted_by?: { user_id: ObjectId; until: Date | null }[] // users who muted this conversation
  history_cleared_by?: HistoryClearMarker[]
  created_at?: Date
  updated_at?: Date
}

export default class DirectConversation {
  _id?: ObjectId
  user1_id: ObjectId // user1_id < user2_id
  user2_id: ObjectId
  last_message_at: Date
  last_message_preview: MessagePreview
  last_message_overrides: LastMessageOverride[]
  hidden_by: ObjectId[]
  pinned_by: ObjectId[]
  muted_by: { user_id: ObjectId; until: Date | null }[]
  history_cleared_by: HistoryClearMarker[]
  created_at?: Date
  updated_at?: Date
  constructor(data: DirectConversationType) {
    this._id = data._id
    this.user1_id = data.user1_id
    this.user2_id = data.user2_id
    this.last_message_at = data.last_message_at
    this.last_message_preview = data.last_message_preview
    this.last_message_overrides = data.last_message_overrides || []
    this.hidden_by = data.hidden_by || []
    this.pinned_by = data.pinned_by || []
    this.muted_by = data.muted_by || []
    this.history_cleared_by = data.history_cleared_by || []
    this.created_at = data.created_at || new Date()
    this.updated_at = data.updated_at || new Date()
  }
}
