import { ObjectId } from 'mongodb'
import { Media } from '~/constants/enums'

type ConversationType = 'direct' | 'group'

interface MessageType {
  _id: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationType // 'direct' hoặc 'group'
  sender_id: ObjectId
  content: string
  media_ids: ObjectId[]
  send_at: Date
  read_by: ObjectId[] // Những người đã đọc tin nhắn
  reply_to_message_id?: ObjectId // Nếu đây là tin trả lời một tin khác
  status: 'sent' | 'revoked' | 'deleted'
  reactions: { emoji: string; user_id: ObjectId }[]
}

export default class Message {
  _id?: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationType
  sender_id: ObjectId
  content: string
  media_ids: ObjectId[]
  send_at?: Date
  read_by?: ObjectId[]
  reply_to_message_id?: ObjectId
  status: 'sent' | 'revoked' | 'deleted'
  reactions: { emoji: string; user_id: ObjectId }[]

  constructor(data: MessageType) {
    this._id = data._id
    this.conversation_id = data.conversation_id
    this.conversation_type = data.conversation_type
    this.sender_id = data.sender_id
    this.content = data.content
    this.media_ids = data.media_ids || []
    this.send_at = data.send_at || new Date()
    this.read_by = data.read_by || []
    this.reply_to_message_id = data.reply_to_message_id
    this.status = data.status || 'sent'
    this.reactions = data.reactions || []
  }
}
