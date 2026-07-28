import { SuccessResponseDto } from '~/common/success-response.dto'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import type MediaMetadata from '~/schemas/MediaMetadata.schema'
import type { ObjectId } from 'mongodb'
import { MediaType } from '~/constants/enums'

export type MessageReactionEmoji = string

const messageReactionSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const messageReactionEmojiPattern = /(?:\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F|\u20E3)/u

export const isMessageReactionEmoji = (value: string): value is MessageReactionEmoji =>
  value.length <= 64 &&
  [...messageReactionSegmenter.segment(value)].length === 1 &&
  messageReactionEmojiPattern.test(value)

export type ConversationMediaInfo = Pick<
  MediaMetadata,
  '_id' | 'url' | 'thumbnail' | 'type' | 'status' | 'created_at' | 'updated_at'
>

export interface MessageSenderInfo {
  _id: ObjectId
  name: string
  username: string
  avatar?: string
}

export type MessageReplyMediaType = MediaType.Image | MediaType.Video | MediaType.Audio

export interface MessageReplyPreview {
  _id: ObjectId
  sender_info: MessageSenderInfo | null
  content: string
  media_type?: MessageReplyMediaType
  status: 'sent' | 'revoked'
}

export interface MessageRevokedEvent {
  conversation_id: string
  message_id: string
}

export interface MessageDeletedForMeEvent {
  conversation_id: string
  message_id: string
}

export interface MessageReactionItem {
  emoji: MessageReactionEmoji
  user_id: string
}

export interface MessageReactionSummaryItem {
  emoji: MessageReactionEmoji
  count: number
}

export interface MessageReactionState {
  reactions: MessageReactionItem[]
  summary: MessageReactionSummaryItem[]
}

export interface MessageReactionUpdatedEvent extends MessageReactionState {
  conversation_id: string
  message_id: string
}

export type MessageWithMediaInfo = Message & {
  medias_info?: ConversationMediaInfo[]
}

export type PublicMessageWithMediaInfo = Omit<MessageWithMediaInfo, 'deleted_by'>

export type HydratedMessage = PublicMessageWithMediaInfo & {
  sender_info: MessageSenderInfo | null
  reply_to: MessageReplyPreview | null
}

export interface MessagePageData {
  messages: HydratedMessage[]
  next_cursor: string | null
  has_next_page: boolean
}

export interface MessageContextData {
  messages: HydratedMessage[]
  target_message_id: string
  older_cursor: string | null
  newer_cursor: string | null
}

export interface ConversationLookupQueryDto {
  q: string
  cursor?: string
  limit: number
}

export interface GroupConversationLookupItem {
  _id: string
  name: string
  avatar_url?: string
  member_count: number
  is_hidden: boolean
}

export interface GroupConversationLookupPage {
  groups: GroupConversationLookupItem[]
  next_cursor: string | null
  has_next_page: boolean
}

export class CreateGroupConversationBodyDto {
  constructor(
    public name: string,
    public members: string[],
    public avatar_url?: string
  ) {}
}

export class ReactMessageBodyDto {
  constructor(public emoji: MessageReactionEmoji) {}
}

export class PaginationQueryDto {
  constructor(
    public cursor: string | undefined,
    public limit: number
  ) {}
}

export class MessageContextQueryDto {
  constructor(
    public before: number,
    public after: number
  ) {}
}

export class GetConversationsResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class ConversationResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class GetMessagesResponseDto extends SuccessResponseDto<MessagePageData> {
  constructor(statusCode: number, message: string, data: MessagePageData) {
    super(statusCode, message, data)
  }
}

export class GetMessageContextResponseDto extends SuccessResponseDto<MessageContextData> {
  constructor(statusCode: number, message: string, data: MessageContextData) {
    super(statusCode, message, data)
  }
}

export class GroupConversationLookupResponseDto extends SuccessResponseDto<GroupConversationLookupPage> {
  constructor(statusCode: number, message: string, data: GroupConversationLookupPage) {
    super(statusCode, message, data)
  }
}

export class MessageActionResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
