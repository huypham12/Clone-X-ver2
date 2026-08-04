import { SuccessResponseDto } from '~/common/success-response.dto'
import type { NotificationTargetType, TweetType } from '~/constants/enums'
import type { ObjectId } from 'mongodb'
import type { EligibleNotificationType } from '../notification-eligibility'

export interface NotificationActorInfo {
  _id: ObjectId
  name: string
  username: string
  avatar?: string
}

export interface NotificationUserTargetInfo extends NotificationActorInfo {
  target_type: NotificationTargetType.User
}

export interface NotificationTweetTargetInfo {
  _id: ObjectId
  target_type: NotificationTargetType.Tweet
  owner_id: ObjectId
  tweet_type: TweetType
  content: string
}

export interface NotificationMessageTargetInfo {
  _id: ObjectId
  target_type: NotificationTargetType.Message
  conversation_id: ObjectId
  sender_id: ObjectId
  content: string
  status: 'sent' | 'revoked' | 'deleted'
}

export interface NotificationConversationTargetInfo {
  _id: ObjectId
  target_type: NotificationTargetType.Conversation
  conversation_type: 'direct' | 'group'
  name?: string
  avatar_url?: string
}

export type NotificationTargetInfo =
  | NotificationUserTargetInfo
  | NotificationTweetTargetInfo
  | NotificationMessageTargetInfo
  | NotificationConversationTargetInfo

export interface NotificationListItem {
  _id: ObjectId
  recipient_id: ObjectId
  sender_id: ObjectId | null
  type: EligibleNotificationType
  target_id: ObjectId | null
  is_read: boolean
  created_at: Date
  target_type: NotificationTargetType | null
  actor_ids_preview: ObjectId[]
  actor_count: number
  context: Record<string, unknown>
  deduplication_key?: string
  aggregation_key?: string
  aggregation_active: boolean
  read_at: Date | null
  updated_at: Date
  invalidated_at: Date | null
  actor_info: NotificationActorInfo | null
  actor_infos_preview: Array<NotificationActorInfo | null>
  target_info: NotificationTargetInfo | null
}

export interface NotificationPageData {
  notifications: NotificationListItem[]
  unreadCount: number
  next_cursor: string | null
  has_next_page: boolean
}

export class GetNotificationsResponseDto extends SuccessResponseDto<NotificationPageData> {
  constructor(statusCode: number, message: string, data: NotificationPageData) {
    super(statusCode, message, data)
  }
}

export class NotificationResponseDto<
  T extends
    | { updatedCount: number; unreadCount: number; version: number }
    | { success: true; unreadCount: number; version: number }
    | { unreadCount: number; version: number; updated_at: Date }
> extends SuccessResponseDto<T> {
  constructor(statusCode: number, message: string, data: T) {
    super(statusCode, message, data)
  }
}
