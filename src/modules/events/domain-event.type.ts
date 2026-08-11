import { ObjectId } from 'mongodb'
import {
  ConversationSystemEventType,
  NotificationTargetType,
  NotificationType,
  TweetAudience,
  TweetType
} from '~/constants/enums'
import type { NotificationContext } from '~/schemas/Notification.schema'

export enum DomainEventType {
  LegacyNotificationRequested = 'LegacyNotificationRequested',
  UserFollowed = 'UserFollowed',
  TweetCreated = 'TweetCreated',
  TweetMentionsChanged = 'TweetMentionsChanged',
  TweetLiked = 'TweetLiked',
  TweetUnliked = 'TweetUnliked',
  TweetReposted = 'TweetReposted',
  TweetUndoRepost = 'TweetUndoRepost',
  MessageCreated = 'MessageCreated',
  GroupManagementChanged = 'GroupManagementChanged',
  MessageReactionChanged = 'MessageReactionChanged',
  MessageReactionRemoved = 'MessageReactionRemoved',
  TweetDeleted = 'TweetDeleted',
  MessageRevoked = 'MessageRevoked',
  MessageDeletedForRecipient = 'MessageDeletedForRecipient',
  UserBlocked = 'UserBlocked',
  UserUnblocked = 'UserUnblocked'
}

export enum DomainAggregateType {
  LegacyNotification = 'LEGACY_NOTIFICATION',
  FollowerRelation = 'FOLLOWER_RELATION',
  Tweet = 'TWEET',
  TweetInteraction = 'TWEET_INTERACTION',
  Message = 'MESSAGE',
  Conversation = 'CONVERSATION',
  UserRelationship = 'USER_RELATIONSHIP'
}

export interface DomainEventEnvelope<TType extends DomainEventType, TPayload> {
  event_id: string
  type: TType
  aggregate_type: DomainAggregateType
  aggregate_id: ObjectId
  actor_id: ObjectId | null
  payload: TPayload
  occurred_at: Date
}

export type ActorDomainEventEnvelope<TType extends DomainEventType, TPayload> = Omit<
  DomainEventEnvelope<TType, TPayload>,
  'actor_id'
> & { actor_id: ObjectId }

interface LifecycleContinuationPayload {
  cleanup_root_event_id?: string
  cleanup_stage?: string
  cleanup_cursor?: ObjectId
}

export interface LegacyNotificationRequestedPayload extends Record<string, unknown> {
  recipient_id: ObjectId
  notification_type: NotificationType
  target_id: ObjectId | null
  target_type?: NotificationTargetType
  context?: NotificationContext
  source_type: 'LEGACY'
  source_id: string
}

export type LegacyNotificationRequestedEvent = DomainEventEnvelope<
  DomainEventType.LegacyNotificationRequested,
  LegacyNotificationRequestedPayload
>

export interface UserFollowedPayload extends Record<string, unknown> {
  relation_id: ObjectId
  follower_id: ObjectId
  followed_user_id: ObjectId
  source_type: 'FOLLOWER'
  source_id: string
}

export type UserFollowedEvent = ActorDomainEventEnvelope<DomainEventType.UserFollowed, UserFollowedPayload>

export interface TweetCreatedPayload extends Record<string, unknown> {
  tweet_id: ObjectId
  tweet_type: TweetType
  audience: TweetAudience
  parent_id: ObjectId | null
  mention_ids: ObjectId[]
  source_type: 'TWEET'
  source_id: string
}

export type TweetCreatedEvent = ActorDomainEventEnvelope<DomainEventType.TweetCreated, TweetCreatedPayload>

export interface TweetMentionsChangedPayload extends Record<string, unknown>, LifecycleContinuationPayload {
  tweet_id: ObjectId
  added_mention_ids: ObjectId[]
  removed_mention_ids: ObjectId[]
  current_mention_ids: ObjectId[]
  visibility_revoked?: boolean
  source_type: 'TWEET'
  source_id: string
}

export type TweetMentionsChangedEvent = ActorDomainEventEnvelope<
  DomainEventType.TweetMentionsChanged,
  TweetMentionsChangedPayload
>

interface TweetInteractionPayload extends Record<string, unknown> {
  relation_id: ObjectId
  tweet_id: ObjectId
  source_id: string
}

export interface TweetLikeInteractionPayload extends TweetInteractionPayload {
  source_type: 'LIKE'
}

export interface TweetRepostInteractionPayload extends TweetInteractionPayload {
  source_type: 'RETWEET'
}

export type TweetLikedEvent = ActorDomainEventEnvelope<DomainEventType.TweetLiked, TweetLikeInteractionPayload>
export type TweetUnlikedEvent = ActorDomainEventEnvelope<DomainEventType.TweetUnliked, TweetLikeInteractionPayload>
export type TweetRepostedEvent = ActorDomainEventEnvelope<
  DomainEventType.TweetReposted,
  TweetRepostInteractionPayload
>
export type TweetUndoRepostEvent = ActorDomainEventEnvelope<
  DomainEventType.TweetUndoRepost,
  TweetRepostInteractionPayload
>

export interface MessageCreatedPayload extends Record<string, unknown> {
  message_id: ObjectId
  conversation_id: ObjectId
  conversation_type: 'direct' | 'group'
  recipient_ids: ObjectId[]
  reply_to_message_id: ObjectId | null
  mention_user_ids: ObjectId[]
  source_type: 'MESSAGE'
  source_id: string
}

export type MessageCreatedEvent = ActorDomainEventEnvelope<DomainEventType.MessageCreated, MessageCreatedPayload>

export interface GroupManagementChangedPayload extends Record<string, unknown> {
  conversation_id: ObjectId
  system_message_id: ObjectId
  system_event_type: ConversationSystemEventType
  affected_user_ids: ObjectId[]
  direct_recipient_ids: ObjectId[]
  notification_type: NotificationType.GroupAdd | NotificationType.GroupKick | NotificationType.AdminGranted | NotificationType.AdminRevoked | null
  source_type: 'GROUP_EVENT'
  source_id: string
}

export type GroupManagementChangedEvent = ActorDomainEventEnvelope<
  DomainEventType.GroupManagementChanged,
  GroupManagementChangedPayload
>

interface MessageReactionPayload extends Record<string, unknown> {
  message_id: ObjectId
  conversation_id: ObjectId
  conversation_type: 'direct' | 'group'
  source_type: 'MESSAGE_REACTION'
  source_id: string
}

export interface MessageReactionChangedPayload extends MessageReactionPayload {
  emoji: string
}

export type MessageReactionChangedEvent = ActorDomainEventEnvelope<
  DomainEventType.MessageReactionChanged,
  MessageReactionChangedPayload
>
export type MessageReactionRemovedEvent = ActorDomainEventEnvelope<
  DomainEventType.MessageReactionRemoved,
  MessageReactionPayload
>

export interface TweetDeletedPayload extends Record<string, unknown>, LifecycleContinuationPayload {
  tweet_id: ObjectId
  tweet_type: TweetType
  parent_id: ObjectId | null
  source_type: 'TWEET'
  source_id: string
}

export type TweetDeletedEvent = ActorDomainEventEnvelope<DomainEventType.TweetDeleted, TweetDeletedPayload>

interface MessageLifecyclePayload extends Record<string, unknown>, LifecycleContinuationPayload {
  message_id: ObjectId
  conversation_id: ObjectId
  source_type: 'MESSAGE'
  source_id: string
}

export type MessageRevokedDomainEvent = ActorDomainEventEnvelope<
  DomainEventType.MessageRevoked,
  MessageLifecyclePayload
>

export interface MessageDeletedForRecipientPayload extends MessageLifecyclePayload {
  recipient_id: ObjectId
}

export type MessageDeletedForRecipientEvent = ActorDomainEventEnvelope<
  DomainEventType.MessageDeletedForRecipient,
  MessageDeletedForRecipientPayload
>

interface UserBlockLifecyclePayload extends Record<string, unknown>, LifecycleContinuationPayload {
  relation_id: ObjectId
  blocker_id: ObjectId
  blocked_user_id: ObjectId
  source_type: 'USER_BLOCK'
  source_id: string
}

export type UserBlockedEvent = ActorDomainEventEnvelope<DomainEventType.UserBlocked, UserBlockLifecyclePayload>
export type UserUnblockedEvent = ActorDomainEventEnvelope<DomainEventType.UserUnblocked, UserBlockLifecyclePayload>

export type DomainEvent =
  | LegacyNotificationRequestedEvent
  | UserFollowedEvent
  | TweetCreatedEvent
  | TweetMentionsChangedEvent
  | TweetLikedEvent
  | TweetUnlikedEvent
  | TweetRepostedEvent
  | TweetUndoRepostEvent
  | MessageCreatedEvent
  | GroupManagementChangedEvent
  | MessageReactionChangedEvent
  | MessageReactionRemovedEvent
  | TweetDeletedEvent
  | MessageRevokedDomainEvent
  | MessageDeletedForRecipientEvent
  | UserBlockedEvent
  | UserUnblockedEvent

export class UnsupportedDomainEventError extends Error {
  constructor(type: unknown) {
    super(`Unsupported domain event type: ${typeof type === 'string' ? type : 'unknown'}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === 'string' && Object.values(NotificationType).some((type) => type === value)

const isNotificationTargetType = (value: unknown): value is NotificationTargetType =>
  typeof value === 'string' && Object.values(NotificationTargetType).some((type) => type === value)

const isContext = (value: unknown): value is NotificationContext => isRecord(value) && !Array.isArray(value)

const isObjectIdArray = (value: unknown): value is ObjectId[] =>
  Array.isArray(value) && value.every((item) => item instanceof ObjectId)

const isTweetType = (value: unknown): value is TweetType =>
  typeof value === 'number' && Object.values(TweetType).some((type) => type === value)

const isTweetAudience = (value: unknown): value is TweetAudience =>
  typeof value === 'number' && Object.values(TweetAudience).some((audience) => audience === value)

const parseLifecycleContinuation = (payload: Record<string, unknown>): LifecycleContinuationPayload => {
  if (
    (payload.cleanup_root_event_id !== undefined &&
      (typeof payload.cleanup_root_event_id !== 'string' || payload.cleanup_root_event_id.length === 0)) ||
    (payload.cleanup_stage !== undefined &&
      (typeof payload.cleanup_stage !== 'string' || payload.cleanup_stage.length === 0)) ||
    (payload.cleanup_cursor !== undefined && !(payload.cleanup_cursor instanceof ObjectId))
  ) {
    throw new Error('Invalid lifecycle cleanup continuation')
  }
  return {
    ...(typeof payload.cleanup_root_event_id === 'string'
      ? { cleanup_root_event_id: payload.cleanup_root_event_id }
      : {}),
    ...(typeof payload.cleanup_stage === 'string' ? { cleanup_stage: payload.cleanup_stage } : {}),
    ...(payload.cleanup_cursor instanceof ObjectId ? { cleanup_cursor: payload.cleanup_cursor } : {})
  }
}

interface ParsedEnvelope {
  event_id: string
  aggregate_type: DomainAggregateType
  aggregate_id: ObjectId
  actor_id: ObjectId | null
  occurred_at: Date
  payload: Record<string, unknown>
}

const parseEnvelope = (value: Record<string, unknown>, aggregateType: DomainAggregateType): ParsedEnvelope => {
  if (
    typeof value.event_id !== 'string' ||
    value.event_id.length === 0 ||
    value.aggregate_type !== aggregateType ||
    !(value.aggregate_id instanceof ObjectId) ||
    (value.actor_id !== null && !(value.actor_id instanceof ObjectId)) ||
    !(value.occurred_at instanceof Date) ||
    Number.isNaN(value.occurred_at.getTime()) ||
    !isRecord(value.payload)
  ) {
    throw new Error(`Invalid ${String(value.type)} envelope`)
  }

  return {
    event_id: value.event_id,
    aggregate_type: aggregateType,
    aggregate_id: value.aggregate_id,
    actor_id: value.actor_id,
    occurred_at: value.occurred_at,
    payload: value.payload
  }
}

export const parseDomainEvent = (value: unknown): DomainEvent => {
  if (!isRecord(value)) throw new UnsupportedDomainEventError(undefined)
  switch (value.type) {
    case DomainEventType.LegacyNotificationRequested: {
      const envelope = parseEnvelope(value, DomainAggregateType.LegacyNotification)
      const payload = envelope.payload
      if (
        !(payload.recipient_id instanceof ObjectId) ||
        !isNotificationType(payload.notification_type) ||
        (payload.target_id !== null && !(payload.target_id instanceof ObjectId)) ||
        (payload.target_type !== undefined && !isNotificationTargetType(payload.target_type)) ||
        (payload.context !== undefined && !isContext(payload.context)) ||
        payload.source_type !== 'LEGACY' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id.length === 0
      ) {
        throw new Error('Invalid LegacyNotificationRequested payload')
      }

      return {
        ...envelope,
        type: DomainEventType.LegacyNotificationRequested,
        payload: {
          recipient_id: payload.recipient_id,
          notification_type: payload.notification_type,
          target_id: payload.target_id,
          target_type: payload.target_type,
          context: payload.context,
          source_type: 'LEGACY',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.UserFollowed: {
      const envelope = parseEnvelope(value, DomainAggregateType.FollowerRelation)
      const payload = envelope.payload
      if (
        !(payload.relation_id instanceof ObjectId) ||
        !(payload.follower_id instanceof ObjectId) ||
        !(payload.followed_user_id instanceof ObjectId) ||
        envelope.actor_id === null ||
        !envelope.actor_id.equals(payload.follower_id) ||
        !envelope.aggregate_id.equals(payload.relation_id) ||
        payload.source_type !== 'FOLLOWER' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.relation_id.toHexString()
      ) {
        throw new Error('Invalid UserFollowed payload')
      }
      return {
        ...envelope,
        type: DomainEventType.UserFollowed,
        actor_id: envelope.actor_id,
        payload: {
          relation_id: payload.relation_id,
          follower_id: payload.follower_id,
          followed_user_id: payload.followed_user_id,
          source_type: 'FOLLOWER',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.TweetCreated: {
      const envelope = parseEnvelope(value, DomainAggregateType.Tweet)
      const payload = envelope.payload
      if (
        !(payload.tweet_id instanceof ObjectId) ||
        !isTweetType(payload.tweet_type) ||
        !isTweetAudience(payload.audience) ||
        (payload.parent_id !== null && !(payload.parent_id instanceof ObjectId)) ||
        !isObjectIdArray(payload.mention_ids) ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.tweet_id) ||
        payload.source_type !== 'TWEET' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.tweet_id.toHexString()
      ) {
        throw new Error('Invalid TweetCreated payload')
      }
      return {
        ...envelope,
        type: DomainEventType.TweetCreated,
        actor_id: envelope.actor_id,
        payload: {
          tweet_id: payload.tweet_id,
          tweet_type: payload.tweet_type,
          audience: payload.audience,
          parent_id: payload.parent_id,
          mention_ids: payload.mention_ids,
          source_type: 'TWEET',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.TweetMentionsChanged: {
      const envelope = parseEnvelope(value, DomainAggregateType.Tweet)
      const payload = envelope.payload
      if (
        !(payload.tweet_id instanceof ObjectId) ||
        !isObjectIdArray(payload.added_mention_ids) ||
        !isObjectIdArray(payload.removed_mention_ids) ||
        !isObjectIdArray(payload.current_mention_ids) ||
        (payload.visibility_revoked !== undefined && typeof payload.visibility_revoked !== 'boolean') ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.tweet_id) ||
        payload.source_type !== 'TWEET' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.tweet_id.toHexString()
      ) {
        throw new Error('Invalid TweetMentionsChanged payload')
      }
      return {
        ...envelope,
        type: DomainEventType.TweetMentionsChanged,
        actor_id: envelope.actor_id,
        payload: {
          tweet_id: payload.tweet_id,
          added_mention_ids: payload.added_mention_ids,
          removed_mention_ids: payload.removed_mention_ids,
          current_mention_ids: payload.current_mention_ids,
          visibility_revoked: payload.visibility_revoked === true,
          ...parseLifecycleContinuation(payload),
          source_type: 'TWEET',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.TweetLiked:
    case DomainEventType.TweetUnliked:
    case DomainEventType.TweetReposted:
    case DomainEventType.TweetUndoRepost: {
      const envelope = parseEnvelope(value, DomainAggregateType.TweetInteraction)
      const payload = envelope.payload
      const isLikeEvent = value.type === DomainEventType.TweetLiked || value.type === DomainEventType.TweetUnliked
      const expectedSourceType = isLikeEvent ? 'LIKE' : 'RETWEET'
      if (
        !(payload.relation_id instanceof ObjectId) ||
        !(payload.tweet_id instanceof ObjectId) ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.relation_id) ||
        payload.source_type !== expectedSourceType ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.relation_id.toHexString()
      ) {
        throw new Error(`Invalid ${value.type} payload`)
      }
      const interactionPayload = {
        relation_id: payload.relation_id,
        tweet_id: payload.tweet_id,
        source_id: payload.source_id
      }
      if (value.type === DomainEventType.TweetLiked) {
        return {
          ...envelope,
          type: value.type,
          actor_id: envelope.actor_id,
          payload: { ...interactionPayload, source_type: 'LIKE' }
        }
      }
      if (value.type === DomainEventType.TweetUnliked) {
        return {
          ...envelope,
          type: value.type,
          actor_id: envelope.actor_id,
          payload: { ...interactionPayload, source_type: 'LIKE' }
        }
      }
      if (value.type === DomainEventType.TweetReposted) {
        return {
          ...envelope,
          type: value.type,
          actor_id: envelope.actor_id,
          payload: { ...interactionPayload, source_type: 'RETWEET' }
        }
      }
      return {
        ...envelope,
        type: value.type,
        actor_id: envelope.actor_id,
        payload: { ...interactionPayload, source_type: 'RETWEET' }
      }
    }
    case DomainEventType.MessageCreated: {
      const envelope = parseEnvelope(value, DomainAggregateType.Message)
      const payload = envelope.payload
      if (
        !(payload.message_id instanceof ObjectId) ||
        !(payload.conversation_id instanceof ObjectId) ||
        (payload.conversation_type !== 'direct' && payload.conversation_type !== 'group') ||
        !isObjectIdArray(payload.recipient_ids) ||
        (payload.reply_to_message_id !== null && !(payload.reply_to_message_id instanceof ObjectId)) ||
        (payload.mention_user_ids !== undefined && !isObjectIdArray(payload.mention_user_ids)) ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.message_id) ||
        payload.source_type !== 'MESSAGE' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.message_id.toHexString()
      ) {
        throw new Error('Invalid MessageCreated payload')
      }
      return {
        ...envelope,
        type: DomainEventType.MessageCreated,
        actor_id: envelope.actor_id,
        payload: {
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          conversation_type: payload.conversation_type,
          recipient_ids: payload.recipient_ids,
          reply_to_message_id: payload.reply_to_message_id,
          mention_user_ids: payload.mention_user_ids ?? [],
          source_type: 'MESSAGE',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.GroupManagementChanged: {
      const envelope = parseEnvelope(value, DomainAggregateType.Conversation)
      const payload = envelope.payload
      const notificationType = payload.notification_type
      const allowedNotificationType =
        notificationType === null ||
        notificationType === NotificationType.GroupAdd ||
        notificationType === NotificationType.GroupKick ||
        notificationType === NotificationType.AdminGranted ||
        notificationType === NotificationType.AdminRevoked
      const systemEventType = payload.system_event_type
      const allowedSystemEventType =
        typeof systemEventType === 'string' &&
        Object.values(ConversationSystemEventType).some((type) => type === systemEventType)
      if (
        !(payload.conversation_id instanceof ObjectId) ||
        !(payload.system_message_id instanceof ObjectId) ||
        !allowedSystemEventType ||
        !isObjectIdArray(payload.affected_user_ids) ||
        !isObjectIdArray(payload.direct_recipient_ids) ||
        !allowedNotificationType ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.conversation_id) ||
        payload.source_type !== 'GROUP_EVENT' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.system_message_id.toHexString()
      ) {
        throw new Error('Invalid GroupManagementChanged payload')
      }
      return {
        ...envelope,
        type: DomainEventType.GroupManagementChanged,
        actor_id: envelope.actor_id,
        payload: {
          conversation_id: payload.conversation_id,
          system_message_id: payload.system_message_id,
          system_event_type: systemEventType as ConversationSystemEventType,
          affected_user_ids: payload.affected_user_ids,
          direct_recipient_ids: payload.direct_recipient_ids,
          notification_type: notificationType as GroupManagementChangedPayload['notification_type'],
          source_type: 'GROUP_EVENT',
          source_id: payload.source_id
        }
      }
    }
    case DomainEventType.MessageReactionChanged:
    case DomainEventType.MessageReactionRemoved: {
      const envelope = parseEnvelope(value, DomainAggregateType.Message)
      const payload = envelope.payload
      if (
        !(payload.message_id instanceof ObjectId) ||
        !(payload.conversation_id instanceof ObjectId) ||
        (payload.conversation_type !== 'direct' && payload.conversation_type !== 'group') ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.message_id) ||
        payload.source_type !== 'MESSAGE_REACTION' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== `${payload.message_id.toHexString()}:${envelope.actor_id.toHexString()}` ||
        (value.type === DomainEventType.MessageReactionChanged &&
          (typeof payload.emoji !== 'string' || payload.emoji.length === 0))
      ) {
        throw new Error(`Invalid ${value.type} payload`)
      }
      const conversationType: 'direct' | 'group' = payload.conversation_type
      const commonPayload: MessageReactionPayload = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        conversation_type: conversationType,
        source_type: 'MESSAGE_REACTION',
        source_id: payload.source_id
      }
      if (value.type === DomainEventType.MessageReactionChanged) {
        if (typeof payload.emoji !== 'string') throw new Error('Invalid MessageReactionChanged payload')
        return {
          ...envelope,
          type: DomainEventType.MessageReactionChanged,
          actor_id: envelope.actor_id,
          payload: { ...commonPayload, emoji: payload.emoji }
        }
      }
      return {
        ...envelope,
        type: DomainEventType.MessageReactionRemoved,
        actor_id: envelope.actor_id,
        payload: commonPayload
      }
    }
    case DomainEventType.TweetDeleted: {
      const envelope = parseEnvelope(value, DomainAggregateType.Tweet)
      const payload = envelope.payload
      if (
        !(payload.tweet_id instanceof ObjectId) ||
        !isTweetType(payload.tweet_type) ||
        (payload.parent_id !== null && !(payload.parent_id instanceof ObjectId)) ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.tweet_id) ||
        payload.source_type !== 'TWEET' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.tweet_id.toHexString()
      ) {
        throw new Error('Invalid TweetDeleted payload')
      }
      return {
        ...envelope,
        type: DomainEventType.TweetDeleted,
        actor_id: envelope.actor_id,
        payload: {
          tweet_id: payload.tweet_id,
          tweet_type: payload.tweet_type,
          parent_id: payload.parent_id,
          source_type: 'TWEET',
          source_id: payload.source_id,
          ...parseLifecycleContinuation(payload)
        }
      }
    }
    case DomainEventType.MessageRevoked:
    case DomainEventType.MessageDeletedForRecipient: {
      const envelope = parseEnvelope(value, DomainAggregateType.Message)
      const payload = envelope.payload
      const recipientId = payload.recipient_id
      if (
        !(payload.message_id instanceof ObjectId) ||
        !(payload.conversation_id instanceof ObjectId) ||
        envelope.actor_id === null ||
        !envelope.aggregate_id.equals(payload.message_id) ||
        payload.source_type !== 'MESSAGE' ||
        typeof payload.source_id !== 'string' ||
        (value.type === DomainEventType.MessageRevoked && payload.source_id !== payload.message_id.toHexString()) ||
        (value.type === DomainEventType.MessageDeletedForRecipient &&
          (!(recipientId instanceof ObjectId) ||
            !recipientId.equals(envelope.actor_id) ||
            payload.source_id !== `${payload.message_id.toHexString()}:${recipientId.toHexString()}`))
      ) {
        throw new Error(`Invalid ${value.type} payload`)
      }
      const commonPayload: MessageLifecyclePayload = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        source_type: 'MESSAGE',
        source_id: payload.source_id,
        ...parseLifecycleContinuation(payload)
      }
      if (value.type === DomainEventType.MessageRevoked) {
        return {
          ...envelope,
          type: DomainEventType.MessageRevoked,
          actor_id: envelope.actor_id,
          payload: commonPayload
        }
      }
      if (!(recipientId instanceof ObjectId)) throw new Error('Invalid MessageDeletedForRecipient payload')
      return {
        ...envelope,
        type: DomainEventType.MessageDeletedForRecipient,
        actor_id: envelope.actor_id,
        payload: { ...commonPayload, recipient_id: recipientId }
      }
    }
    case DomainEventType.UserBlocked:
    case DomainEventType.UserUnblocked: {
      const envelope = parseEnvelope(value, DomainAggregateType.UserRelationship)
      const payload = envelope.payload
      if (
        !(payload.relation_id instanceof ObjectId) ||
        !(payload.blocker_id instanceof ObjectId) ||
        !(payload.blocked_user_id instanceof ObjectId) ||
        envelope.actor_id === null ||
        !envelope.actor_id.equals(payload.blocker_id) ||
        !envelope.aggregate_id.equals(payload.relation_id) ||
        payload.blocker_id.equals(payload.blocked_user_id) ||
        payload.source_type !== 'USER_BLOCK' ||
        typeof payload.source_id !== 'string' ||
        payload.source_id !== payload.relation_id.toHexString()
      ) {
        throw new Error(`Invalid ${value.type} payload`)
      }
      const blockPayload: UserBlockLifecyclePayload = {
        relation_id: payload.relation_id,
        blocker_id: payload.blocker_id,
        blocked_user_id: payload.blocked_user_id,
        source_type: 'USER_BLOCK',
        source_id: payload.source_id,
        ...parseLifecycleContinuation(payload)
      }
      return value.type === DomainEventType.UserBlocked
        ? { ...envelope, type: DomainEventType.UserBlocked, actor_id: envelope.actor_id, payload: blockPayload }
        : { ...envelope, type: DomainEventType.UserUnblocked, actor_id: envelope.actor_id, payload: blockPayload }
    }
    default:
      throw new UnsupportedDomainEventError(value.type)
  }
}
