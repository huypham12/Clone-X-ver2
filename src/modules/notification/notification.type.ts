import type { ObjectId } from 'mongodb'
import type { NotificationTargetType, NotificationType } from '~/constants/enums'
import type { NotificationContext } from '~/schemas/Notification.schema'

export interface CreateNotificationCommand {
  recipient_id: ObjectId
  sender_id: ObjectId | null
  type: NotificationType
  target_id: ObjectId | null
  target_type?: NotificationTargetType
  context?: NotificationContext
  deduplication_key?: string
  aggregation_key?: string
  aggregation_active?: boolean
  created_at?: Date
}

export type NotificationPolicySkipReason =
  | 'self_notification'
  | 'relation_missing'
  | 'blocked'
  | 'recipient_missing'
  | 'target_missing'
  | 'privacy_restricted'
  | 'unsupported_type'

export type NotificationPolicyDecision =
  | { action: 'create'; command: CreateNotificationCommand }
  | { action: 'skip'; reason: NotificationPolicySkipReason }

export interface TweetNotificationPrimaryContext {
  recipient_id: ObjectId
  type: NotificationType.Reply | NotificationType.Quote
  parent_tweet_id: ObjectId
  mentioned: boolean
}

export interface TweetNotificationPlan {
  commands: CreateNotificationCommand[]
  primary: TweetNotificationPrimaryContext | null
  current_mention_ids: ObjectId[]
}

export interface MessageNotificationPlan {
  commands: CreateNotificationCommand[]
}

export interface GroupManagementNotificationPlan {
  commands: CreateNotificationCommand[]
}

export interface FollowedUserTweetNotificationPlan {
  commands: CreateNotificationCommand[]
}

export interface NotificationDeliveryResult {
  delivered: boolean
}

export interface AggregateNotificationCommand {
  recipient_id: ObjectId
  actor_id: ObjectId
  type: NotificationType.Like | NotificationType.Retweet
  target_id: ObjectId
  target_type: NotificationTargetType.Tweet
  aggregation_key: string
  source_key: string
  event_id: string
  context: NotificationContext
  occurred_at: Date
}

export type AggregateNotificationDecision =
  | { action: 'aggregate'; command: AggregateNotificationCommand }
  | { action: 'skip'; reason: NotificationPolicySkipReason }
