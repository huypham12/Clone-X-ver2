import { SuccessResponseDto } from '~/common/success-response.dto'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'
import type MediaMetadata from '~/schemas/MediaMetadata.schema'

export type ConversationMediaInfo = Pick<
  MediaMetadata,
  '_id' | 'url' | 'thumbnail' | 'type' | 'status' | 'created_at' | 'updated_at'
>

export type MessageWithMediaInfo = Message & {
  medias_info?: ConversationMediaInfo[]
}

export interface MessagePageData {
  messages: MessageWithMediaInfo[]
  next_cursor: string | null
  has_next_page: boolean
}

export interface MessageContextData {
  messages: MessageWithMediaInfo[]
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
  constructor(
    public emoji: string
  ) {}
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
