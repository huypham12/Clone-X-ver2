import { ObjectId } from 'mongodb'

type MessagePreview = {
  sender_id: ObjectId
  content: string
  message_type: 'text' | 'image' | 'video' | 'file'
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
    this.created_at = data.created_at || new Date()
    this.updated_at = data.updated_at || new Date()
  }
}
