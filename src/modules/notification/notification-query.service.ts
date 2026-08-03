import { ObjectId, type Filter, type WithId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationTargetType, TweetAudience, UserVerifyStatus } from '~/constants/enums'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type Notification from '~/schemas/Notification.schema'
import { decodeNotificationCursor, encodeNotificationCursor, type NotificationTupleCursor } from './notification-cursor'
import type {
  NotificationActorInfo,
  NotificationConversationTargetInfo,
  NotificationListItem,
  NotificationMessageTargetInfo,
  NotificationPageData,
  NotificationTargetInfo,
  NotificationTweetTargetInfo,
  NotificationUserTargetInfo
} from './dto'
import { inferLegacyNotificationTargetType } from './notification-policy.service'
import { NotificationRepository } from './notification.repository'
import { NotificationUnreadService } from './notification-unread.service'
import {
  getEligibleNotificationTypeFilter,
  isEligibleNotificationType
} from './notification-eligibility'

const TARGET_PREVIEW_CONTENT_LIMIT = 140

type NormalizedNotification = Omit<NotificationListItem, 'actor_info' | 'actor_infos_preview' | 'target_info'>

const isValidDate = (value: Date | undefined): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime())

const optionalDateOrNull = (value: Date | null | undefined): Date | null =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : null

const uniqueObjectIds = (ids: ObjectId[]): ObjectId[] => {
  const seen = new Set<string>()
  return ids.filter((id) => {
    const value = id.toHexString()
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export class NotificationQueryService {
  private readonly databaseService: DatabaseService
  private readonly repository: NotificationRepository

  constructor(
    databaseService: DatabaseService = sharedDatabaseService,
    repository: NotificationRepository = new NotificationRepository(databaseService),
    private readonly unreadService: NotificationUnreadService = new NotificationUnreadService(databaseService)
  ) {
    this.databaseService = databaseService
    this.repository = repository
  }

  async getNotifications(userId: string, cursor: string | undefined, limit: number): Promise<NotificationPageData> {
    const recipientId = new this.databaseService.ObjectId(userId)
    const tupleCursor = cursor ? await this.resolveCursor(recipientId, cursor) : undefined
    const filter: Filter<Notification> = {
      recipient_id: recipientId,
      type: getEligibleNotificationTypeFilter(),
      invalidated_at: null,
      ...(tupleCursor
        ? {
            $or: [
              { created_at: { $lt: tupleCursor.created_at } },
              { created_at: tupleCursor.created_at, _id: { $lt: tupleCursor._id } }
            ]
          }
        : {})
    }

    const [documents, unreadState] = await Promise.all([
      this.repository.findRecipientPage(filter, limit + 1),
      this.unreadService.get(recipientId)
    ])
    const has_next_page = documents.length > limit
    const page = has_next_page ? documents.slice(0, limit) : documents
    const normalized = page.map((notification) => this.normalize(notification))
    const notifications = await this.hydrate(normalized)
    const lastNotification = page.at(-1)
    const next_cursor =
      has_next_page && lastNotification
        ? encodeNotificationCursor({ created_at: lastNotification.created_at, _id: lastNotification._id })
        : null

    return { notifications, unreadCount: unreadState.unread_count, next_cursor, has_next_page }
  }

  private async resolveCursor(recipientId: ObjectId, cursor: string): Promise<NotificationTupleCursor> {
    const decoded = decodeNotificationCursor(cursor)
    if (decoded.kind === 'tuple') return decoded

    const legacyDocument = await this.repository.findOwnedById(recipientId, decoded._id)
    if (!legacyDocument) {
      throw new HttpError('Notification cursor not found', HTTP_STATUS.BAD_REQUEST)
    }

    return {
      kind: 'tuple',
      created_at: legacyDocument.created_at,
      _id: legacyDocument._id
    }
  }

  private normalize(notification: WithId<Notification>): NormalizedNotification {
    if (!isEligibleNotificationType(notification.type)) {
      throw new Error('Suppressed notification type reached the durable feed')
    }
    const fallbackActorIds = notification.sender_id ? [notification.sender_id] : []
    const storedActorIds = Array.isArray(notification.actor_ids_preview)
      ? notification.actor_ids_preview
      : fallbackActorIds
    const actorIds = uniqueObjectIds(storedActorIds.slice(0, 3))
    const fallbackActorCount = notification.sender_id ? 1 : 0
    const actorCount =
      typeof notification.actor_count === 'number' &&
      Number.isSafeInteger(notification.actor_count) &&
      notification.actor_count >= 0
        ? notification.actor_count
        : fallbackActorCount
    const context =
      typeof notification.context === 'object' && notification.context !== null && !Array.isArray(notification.context)
        ? notification.context
        : {}

    return {
      _id: notification._id,
      recipient_id: notification.recipient_id,
      sender_id: notification.sender_id,
      type: notification.type,
      target_id: notification.target_id ?? null,
      is_read: notification.is_read,
      created_at: notification.created_at,
      target_type: notification.target_type ?? inferLegacyNotificationTargetType(notification.type) ?? null,
      actor_ids_preview: actorIds,
      actor_count: actorCount,
      context,
      deduplication_key:
        typeof notification.deduplication_key === 'string' ? notification.deduplication_key : undefined,
      aggregation_key: typeof notification.aggregation_key === 'string' ? notification.aggregation_key : undefined,
      aggregation_active: notification.aggregation_active ?? false,
      read_at: optionalDateOrNull(notification.read_at),
      updated_at: isValidDate(notification.updated_at) ? notification.updated_at : notification.created_at,
      invalidated_at: optionalDateOrNull(notification.invalidated_at),
      schema_version: notification.schema_version === 2 ? 2 : undefined
    }
  }

  private async hydrate(notifications: NormalizedNotification[]): Promise<NotificationListItem[]> {
    if (notifications.length === 0) return []

    const actorIds = uniqueObjectIds(
      notifications.flatMap((notification) => [
        ...(notification.sender_id ? [notification.sender_id] : []),
        ...notification.actor_ids_preview
      ])
    )
    const recipientId = notifications[0].recipient_id
    const actorInfoById = await this.loadActorInfo(actorIds, recipientId)
    const targetInfoById = await this.loadTargetInfo(notifications, recipientId)

    return notifications.map((notification) => {
      const actorInfo = notification.sender_id
        ? (actorInfoById.get(notification.sender_id.toHexString()) ?? null)
        : null
      const visibleActorIds = notification.actor_ids_preview.filter((actorId) =>
        actorInfoById.has(actorId.toHexString())
      )
      const targetInfo =
        notification.target_id && notification.target_type
          ? (targetInfoById.get(this.targetMapKey(notification.target_type, notification.target_id)) ?? null)
          : null
      const actorVisible = notification.sender_id === null || actorInfo !== null
      const targetVisible = notification.target_id === null || targetInfo !== null
      const fullyVisible = actorVisible && targetVisible

      return {
        ...notification,
        sender_id: actorVisible ? notification.sender_id : null,
        target_id: targetVisible ? notification.target_id : null,
        actor_ids_preview: visibleActorIds,
        context: fullyVisible ? notification.context : {},
        deduplication_key: fullyVisible ? notification.deduplication_key : undefined,
        aggregation_key: fullyVisible ? notification.aggregation_key : undefined,
        actor_info: actorInfo,
        actor_infos_preview: visibleActorIds.map(
          (actorId) => actorInfoById.get(actorId.toHexString()) ?? null
        ),
        target_info: targetInfo
      }
    })
  }

  private async loadActorInfo(
    actorIds: ObjectId[],
    recipientId: ObjectId
  ): Promise<Map<string, NotificationActorInfo>> {
    if (actorIds.length === 0) return new Map()
    const users = await this.databaseService.users
      .find(
        { _id: { $in: actorIds }, verify: { $ne: UserVerifyStatus.Banned } },
        { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
      )
      .toArray()
    const blocks = await this.databaseService.userBlocks
      .find(
        {
          $or: [
            { user_id: recipientId, blocked_user_id: { $in: actorIds } },
            { user_id: { $in: actorIds }, blocked_user_id: recipientId }
          ]
        },
        { projection: { user_id: 1, blocked_user_id: 1 } }
      )
      .toArray()
    const blockedActorIds = new Set(
      blocks.map((block) =>
        block.user_id.equals(recipientId) ? block.blocked_user_id.toHexString() : block.user_id.toHexString()
      )
    )

    return new Map(
      users
        .filter((user) => !blockedActorIds.has(user._id.toHexString()))
        .map((user) => [
          user._id.toHexString(),
          { _id: user._id, name: user.name, username: user.username, avatar: user.avatar }
        ])
    )
  }

  private async loadTargetInfo(
    notifications: NormalizedNotification[],
    recipientId: ObjectId
  ): Promise<Map<string, NotificationTargetInfo>> {
    const targetIdsByType = new Map<NotificationTargetType, ObjectId[]>()
    for (const notification of notifications) {
      if (!notification.target_id || !notification.target_type) continue
      const existing = targetIdsByType.get(notification.target_type) ?? []
      existing.push(notification.target_id)
      targetIdsByType.set(notification.target_type, existing)
    }

    const userIds = uniqueObjectIds(targetIdsByType.get(NotificationTargetType.User) ?? [])
    const tweetIds = uniqueObjectIds(targetIdsByType.get(NotificationTargetType.Tweet) ?? [])
    const messageIds = uniqueObjectIds(targetIdsByType.get(NotificationTargetType.Message) ?? [])
    const conversationIds = uniqueObjectIds(targetIdsByType.get(NotificationTargetType.Conversation) ?? [])

    const [users, tweets, messages] = await Promise.all([
      this.databaseService.users
        .find(
          { _id: { $in: userIds }, verify: { $ne: UserVerifyStatus.Banned } },
          { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
        )
        .toArray(),
      this.databaseService.tweets
        .find(
          { _id: { $in: tweetIds }, audience: TweetAudience.Everyone },
          { projection: { _id: 1, user_id: 1, type: 1, content: 1 } }
        )
        .toArray(),
      this.databaseService.messages
        .find(
          { _id: { $in: messageIds }, status: 'sent', deleted_by: { $ne: recipientId } },
          { projection: { _id: 1, conversation_id: 1, sender_id: 1, content: 1, status: 1 } }
        )
        .toArray()
    ])
    const authorizedConversationIds = uniqueObjectIds([
      ...conversationIds,
      ...messages.map((message) => message.conversation_id)
    ])
    const [directConversations, groupConversations] = await Promise.all([
      this.databaseService.directConversations
        .find(
          {
            _id: { $in: authorizedConversationIds },
            $or: [{ user1_id: recipientId }, { user2_id: recipientId }]
          },
          { projection: { _id: 1, user1_id: 1, user2_id: 1 } }
        )
        .toArray(),
      this.databaseService.groupConversations
        .find(
          { _id: { $in: authorizedConversationIds }, 'members.user_id': recipientId },
          { projection: { _id: 1, name: 1, avatar_url: 1 } }
        )
        .toArray()
    ])
    const allowedConversationIds = new Set([
      ...directConversations.map((conversation) => conversation._id.toHexString()),
      ...groupConversations.map((conversation) => conversation._id.toHexString())
    ])
    const relatedUserIds = uniqueObjectIds([
      ...users.map((user) => user._id),
      ...tweets.map((tweet) => tweet.user_id),
      ...messages.map((message) => message.sender_id),
      ...directConversations.map((conversation) =>
        conversation.user1_id.equals(recipientId) ? conversation.user2_id : conversation.user1_id
      )
    ])
    const visibleUserIds = await this.loadVisibleUserIds(relatedUserIds, recipientId)

    const targetInfo = new Map<string, NotificationTargetInfo>()
    for (const user of users) {
      if (!visibleUserIds.has(user._id.toHexString())) continue
      const info: NotificationUserTargetInfo = {
        _id: user._id,
        target_type: NotificationTargetType.User,
        name: user.name,
        username: user.username,
        avatar: user.avatar
      }
      targetInfo.set(this.targetMapKey(info.target_type, info._id), info)
    }
    for (const tweet of tweets) {
      if (!visibleUserIds.has(tweet.user_id.toHexString())) continue
      const info: NotificationTweetTargetInfo = {
        _id: tweet._id,
        target_type: NotificationTargetType.Tweet,
        owner_id: tweet.user_id,
        tweet_type: tweet.type,
        content: tweet.content.trim().slice(0, TARGET_PREVIEW_CONTENT_LIMIT)
      }
      targetInfo.set(this.targetMapKey(info.target_type, info._id), info)
    }
    for (const message of messages) {
      if (!allowedConversationIds.has(message.conversation_id.toHexString())) continue
      if (!visibleUserIds.has(message.sender_id.toHexString())) continue
      const info: NotificationMessageTargetInfo = {
        _id: message._id,
        target_type: NotificationTargetType.Message,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id,
        content: message.status === 'sent' ? message.content.trim().slice(0, TARGET_PREVIEW_CONTENT_LIMIT) : '',
        status: message.status
      }
      targetInfo.set(this.targetMapKey(info.target_type, info._id), info)
    }
    for (const conversation of directConversations) {
      const counterpartId = conversation.user1_id.equals(recipientId) ? conversation.user2_id : conversation.user1_id
      if (!visibleUserIds.has(counterpartId.toHexString())) continue
      const info: NotificationConversationTargetInfo = {
        _id: conversation._id,
        target_type: NotificationTargetType.Conversation,
        conversation_type: 'direct'
      }
      targetInfo.set(this.targetMapKey(info.target_type, info._id), info)
    }
    for (const conversation of groupConversations) {
      const info: NotificationConversationTargetInfo = {
        _id: conversation._id,
        target_type: NotificationTargetType.Conversation,
        conversation_type: 'group',
        name: conversation.name,
        avatar_url: conversation.avatar_url
      }
      targetInfo.set(this.targetMapKey(info.target_type, info._id), info)
    }

    return targetInfo
  }

  private async loadVisibleUserIds(userIds: ObjectId[], recipientId: ObjectId): Promise<Set<string>> {
    if (userIds.length === 0) return new Set()
    const [users, blocks] = await Promise.all([
      this.databaseService.users
        .find(
          { _id: { $in: userIds }, verify: { $ne: UserVerifyStatus.Banned } },
          { projection: { _id: 1 } }
        )
        .toArray(),
      this.databaseService.userBlocks
        .find(
          {
            $or: [
              { user_id: recipientId, blocked_user_id: { $in: userIds } },
              { user_id: { $in: userIds }, blocked_user_id: recipientId }
            ]
          },
          { projection: { user_id: 1, blocked_user_id: 1 } }
        )
        .toArray()
    ])
    const blockedIds = new Set(
      blocks.map((block) =>
        block.user_id.equals(recipientId) ? block.blocked_user_id.toHexString() : block.user_id.toHexString()
      )
    )
    return new Set(users.map((user) => user._id.toHexString()).filter((id) => !blockedIds.has(id)))
  }

  private targetMapKey(targetType: NotificationTargetType, targetId: ObjectId): string {
    return `${targetType}:${targetId.toHexString()}`
  }
}
