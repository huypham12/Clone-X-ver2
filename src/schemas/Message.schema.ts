import { ObjectId } from 'mongodb'
import { ConversationSystemEventType, MessageKind } from '~/constants/enums'

type ConversationType = 'direct' | 'group'

interface MessageType {
  _id: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationType // 'direct' hoặc 'group'
  sender_id: ObjectId
  kind?: MessageKind
  system_event_type?: ConversationSystemEventType
  affected_user_ids?: ObjectId[]
  context?: Record<string, unknown>
  content: string
  media_ids: ObjectId[]
  send_at?: Date
  read_by?: ObjectId[] // Legacy field; read-state v2 không dual-write.
  reply_to_message_id?: ObjectId // Nếu đây là tin trả lời một tin khác
  mention_user_ids?: ObjectId[]
  client_message_id?: string
  client_payload_hash?: string
  origin_message_id?: ObjectId
  is_forwarded?: boolean
  status: 'sent' | 'revoked' | 'deleted'
  reactions: { emoji: string; user_id: ObjectId }[]
  deleted_by?: ObjectId[]
}

export default class Message {
  _id?: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationType
  sender_id: ObjectId
  kind: MessageKind
  system_event_type?: ConversationSystemEventType
  affected_user_ids: ObjectId[]
  context?: Record<string, unknown>
  content: string
  media_ids: ObjectId[]
  send_at?: Date
  read_by?: ObjectId[]
  reply_to_message_id?: ObjectId
  mention_user_ids: ObjectId[]
  client_message_id?: string
  client_payload_hash?: string
  origin_message_id?: ObjectId
  is_forwarded: boolean
  status: 'sent' | 'revoked' | 'deleted'
  reactions: { emoji: string; user_id: ObjectId }[]
  deleted_by: ObjectId[]

  constructor(data: MessageType) {
    this._id = data._id
    this.conversation_id = data.conversation_id
    this.conversation_type = data.conversation_type
    this.sender_id = data.sender_id
    this.kind = data.kind ?? MessageKind.User
    this.system_event_type = data.system_event_type
    this.affected_user_ids = data.affected_user_ids ?? []
    this.context = data.context
    this.content = data.content
    this.media_ids = data.media_ids || []
    this.send_at = data.send_at || new Date()
    if (data.read_by !== undefined) this.read_by = data.read_by
    else Reflect.deleteProperty(this, 'read_by')
    this.reply_to_message_id = data.reply_to_message_id
    this.mention_user_ids = data.mention_user_ids || []
    this.client_message_id = data.client_message_id
    if (data.client_payload_hash !== undefined) this.client_payload_hash = data.client_payload_hash
    else Reflect.deleteProperty(this, 'client_payload_hash')
    this.origin_message_id = data.origin_message_id
    this.is_forwarded = data.is_forwarded ?? false
    this.status = data.status || 'sent'
    this.reactions = data.reactions || []
    this.deleted_by = data.deleted_by || []
  }
}
