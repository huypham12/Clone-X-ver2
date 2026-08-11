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

type GroupMember = {
  user_id: ObjectId
  role: 'admin' | 'member'
  joined_at: Date // Thời điểm tham gia nhóm
  is_muted?: boolean
  last_seen?: Date
}

interface GroupConversationType {
  _id: ObjectId
  name: string
  avatar_url?: string
  members: GroupMember[]
  created_by: ObjectId
  admin_only_messaging: boolean
  last_message_at: Date
  last_message_preview: MessagePreview
  last_message_overrides?: LastMessageOverride[]
  hidden_by?: ObjectId[]
  pinned_by?: ObjectId[]
  muted_by?: { user_id: ObjectId; until: Date | null }[]
  history_cleared_by?: HistoryClearMarker[]
  created_at: Date
  updated_at: Date
}

export default class GroupConversation {
  _id: ObjectId
  name: string
  avatar_url?: string
  members: GroupMember[]
  created_by: ObjectId
  admin_only_messaging: boolean
  last_message_at: Date
  last_message_preview: MessagePreview
  last_message_overrides: LastMessageOverride[]
  hidden_by: ObjectId[]
  pinned_by: ObjectId[]
  muted_by: { user_id: ObjectId; until: Date | null }[]
  history_cleared_by: HistoryClearMarker[]
  created_at: Date
  updated_at: Date

  constructor(data: GroupConversationType) {
    this._id = data._id
    this.name = data.name
    this.avatar_url = data.avatar_url
    this.members = data.members
    this.created_by = data.created_by
    this.admin_only_messaging = data.admin_only_messaging
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
