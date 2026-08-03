// src/services/database.service.ts

import { MongoClient, Db, Collection, ObjectId, type IndexDescriptionInfo } from 'mongodb'
import {
  User,
  RefreshToken,
  Bookmark,
  DirectConversation,
  Follower,
  GroupConversation,
  Hashtag,
  Like,
  Message,
  Tweet,
  UserBlock,
  MediaMetadata,
  NewsFeed,
  Notification,
  OutboxEvent,
  NotificationState,
  NotificationActor,
  NotificationLifecycleGuard,
  ConversationReadState,
  UserMessageState
} from '~/schemas'
import { envConfig } from './getEnvConfig'
import { TweetType } from '~/constants/enums'

const uri =
  envConfig.db.uri ||
  `mongodb+srv://${encodeURIComponent(envConfig.db.username)}:${encodeURIComponent(envConfig.db.password)}@${envConfig.db.clusterHost}/?retryWrites=true&w=majority&appName=Clone-X-ver2`

export default class DatabaseService {
  private static readonly instance = new DatabaseService()
  private readonly client: MongoClient
  private readonly db: Db
  readonly ObjectId = ObjectId

  private constructor() {
    this.client = new MongoClient(uri)
    this.db = this.client.db(envConfig.db.name)
  }

  static getInstance(): DatabaseService {
    return DatabaseService.instance
  }

  async connect() {
    try {
      await this.db.command({ ping: 1 })
      console.log('MongoDB connected')
    } catch (err) {
      console.error('MongoDB connection error:', err)
      throw err
    }
  }

  async disconnect() {
    await this.client.close()
    console.log('MongoDB disconnected')
  }

  startSession() {
    return this.client.startSession()
  }

  /** Index collections — should be called once during bootstrap */
  async createIndexes() {
    await Promise.all([
      this.indexUsers(),
      this.indexRefreshTokens(),
      this.indexTweets(),
      this.indexNewsFeeds(),
      this.indexBookmarks(),
      this.indexLikes(),
      this.indexHashtags(),
      this.createConversationIndexes(),
      this.createFollowerIndexes(),
      this.createNotificationIndexes(),
      this.createOutboxIndexes()
    ])

    // Both methods build indexes on tweets; keep them sequential during clean bootstrap.
    await this.createTweetInteractionIndexes()
  }

  /** Chat bootstrap indexes kept separate from unrelated legacy collections. */
  async createConversationIndexes() {
    await Promise.all([
      this.indexMessages(),
      this.indexGroupConversations(),
      this.indexUserBlocks(),
      this.indexConversationReadStates(),
      this.indexUserMessageStates()
    ])
    await this.verifyConversationReadStateBaseline()
  }

  async createFollowerIndexes() {
    await this.indexFollowers()
  }

  /** Notification indexes are an independent startup gate. */
  async createNotificationIndexes() {
    await Promise.all([
      this.indexNotifications(),
      this.indexNotificationStates(),
      this.indexNotificationActors(),
      this.indexNotificationLifecycleGuards()
    ])
    await this.verifyNotificationLifecycleBaseline()
  }

  private async verifyNotificationLifecycleBaseline(): Promise<void> {
    const [legacyNotification, notification, actor, state, orphanActor, orphanState, missingState, actorlessAggregate] =
      await Promise.all([
      this.notifications.findOne({ schema_version: { $ne: 2 } }, { projection: { _id: 1 } }),
      this.notifications.findOne({}, { projection: { _id: 1 } }),
      this.notificationActors.findOne({}, { projection: { _id: 1 } }),
      this.notificationStates.findOne({}, { projection: { _id: 1 } }),
      this.notificationActors
        .aggregate([
          {
            $lookup: {
              from: envConfig.db.collections.notifications,
              localField: 'notification_id',
              foreignField: '_id',
              as: 'notification'
            }
          },
          { $match: { notification: { $size: 0 } } },
          { $limit: 1 }
        ])
        .hasNext(),
      this.notificationStates
        .aggregate([
          {
            $lookup: {
              from: envConfig.db.collections.notifications,
              localField: 'recipient_id',
              foreignField: 'recipient_id',
              as: 'notifications'
            }
          },
          { $match: { notifications: { $size: 0 } } },
          { $limit: 1 }
        ])
        .hasNext(),
      this.notifications
        .aggregate([
          {
            $lookup: {
              from: envConfig.db.collections.notificationStates,
              localField: 'recipient_id',
              foreignField: 'recipient_id',
              as: 'state'
            }
          },
          { $match: { state: { $size: 0 } } },
          { $limit: 1 }
        ])
        .hasNext(),
      this.notifications
        .aggregate([
          { $match: { aggregation_active: true, invalidated_at: null } },
          {
            $lookup: {
              from: envConfig.db.collections.notificationActors,
              localField: '_id',
              foreignField: 'notification_id',
              as: 'actors'
            }
          },
          { $match: { actors: { $size: 0 } } },
          { $limit: 1 }
        ])
        .hasNext()
    ])
    if (
      legacyNotification ||
      (!notification && (actor || state)) ||
      orphanActor ||
      orphanState ||
      missingState ||
      actorlessAggregate
    ) {
      throw new Error(
        'Notification read-state/lifecycle baseline is incompatible; reset notifications, notificationActors and notificationStates together'
      )
    }
  }

  async createTweetInteractionIndexes() {
    await this.indexRetweetRelations()
  }

  async createOutboxIndexes() {
    await this.indexOutboxEvents()
  }

  private async indexUsers() {
    await Promise.all([
      this.users.createIndex({ email: 1 }, { name: 'email_1', unique: true }),
      this.users.createIndex({ username: 1 }, { name: 'username_1', unique: true }),
      this.users.createIndex({ email: 1, password: 1 }, { name: 'email_1_password_1' })
    ])
  }

  private async indexRefreshTokens() {
    await Promise.all([
      this.refreshTokens.createIndex({ token: 1 }, { name: 'token_1' }),
      this.refreshTokens.createIndex({ exp: 1 }, { name: 'exp_1', expireAfterSeconds: 0 })
    ])
  }

  private async indexFollowers() {
    const followerIndexName = 'follow_user_id_1_followed_user_id_1'
    const hasFollowerIndex = await this.indexExistsSafely(this.followers, followerIndexName)

    if (!hasFollowerIndex) {
      const duplicateGroups = await this.followers
        .aggregate<{ ids: ObjectId[]; count: number }>([
          {
            $match: {
              follow_user_id: { $type: 'objectId' },
              followed_user_id: { $type: 'objectId' }
            }
          },
          { $sort: { _id: 1 } },
          {
            $group: {
              _id: { follow_user_id: '$follow_user_id', followed_user_id: '$followed_user_id' },
              ids: { $push: '$_id' },
              count: { $sum: 1 }
            }
          },
          { $match: { count: { $gt: 1 } } }
        ])
        .toArray()
      if (duplicateGroups.length > 0) {
        throw new Error(
          `Cannot create unique follower index: ${duplicateGroups.length} duplicate relation group(s) require explicit reconciliation`
        )
      }

      console.log('Creating indexes for followers...')
      await this.followers.createIndex(
        { follow_user_id: 1, followed_user_id: 1 },
        {
          name: followerIndexName,
          unique: true,
          partialFilterExpression: {
            follow_user_id: { $type: 'objectId' },
            followed_user_id: { $type: 'objectId' }
          }
        }
      )
    }

    await this.followers.createIndex(
      { followed_user_id: 1, post_notifications_enabled: 1, _id: 1 },
      { name: 'followed_user_post_notifications_relation' }
    )
  }

  private async indexTweets() {
    await Promise.all([
      this.tweets.createIndex({ content: 'text' }, { name: 'content_text', default_language: 'none' }),
      this.tweets.createIndex({ parent_id: 1, created_at: -1 }, { name: 'parent_id_1_created_at_-1' })
    ])
  }

  private async indexNewsFeeds() {
    await this.newsFeeds.createIndex({ user_id: 1, created_at: -1 }, { name: 'user_id_1_created_at_-1' })
  }

  private async indexBookmarks() {
    await this.bookmarks.createIndex({ user_id: 1, tweet_id: 1 }, { name: 'user_id_1_tweet_id_1', unique: true })
  }

  private async indexLikes() {
    await this.likes.createIndex({ user_id: 1, tweet_id: 1 }, { name: 'user_id_1_tweet_id_1', unique: true })
  }

  private async indexHashtags() {
    await this.hashtags.createIndex({ normalized_name: 1 }, { name: 'normalized_name_1', unique: true })
  }

  private async indexUserBlocks() {
    const exists = await this.indexExistsSafely(this.userBlocks, 'user_id_1_blocked_user_id_1')
    if (exists) return

    const duplicateGroups = await this.userBlocks
      .aggregate<{ ids: ObjectId[]; count: number }>([
        {
          $group: {
            _id: { user_id: '$user_id', blocked_user_id: '$blocked_user_id' },
            ids: { $push: '$_id' },
            count: { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ])
      .toArray()
    if (duplicateGroups.length > 0) {
      throw new Error(
        `Cannot create unique user block index: ${duplicateGroups.length} duplicate relation group(s); reset the local collection or database`
      )
    }

    await this.userBlocks.createIndex(
      { user_id: 1, blocked_user_id: 1 },
      { name: 'user_id_1_blocked_user_id_1', unique: true }
    )
  }

  private async indexMessages() {
    const [hasSearchIndex, hasTimelineIndex, hasContextIndex, messageIndexes] = await Promise.all([
      this.indexExistsSafely(this.messages, 'conversation_id_1_content_text'),
      this.indexExistsSafely(this.messages, 'conversation_id_1_send_at_-1'),
      this.indexExistsSafely(this.messages, 'conversation_status_message_id'),
      this.listIndexesSafely(this.messages)
    ])
    const idempotencyIndex = messageIndexes.find((index) => index.name === 'message_sender_client_id_unique')
    const hasIdempotencyIndex = Boolean(idempotencyIndex)
    if (
      idempotencyIndex &&
      (idempotencyIndex.key.sender_id !== 1 ||
        idempotencyIndex.key.client_message_id !== 1 ||
        Object.keys(idempotencyIndex.key).length !== 2 ||
        idempotencyIndex.unique !== true ||
        idempotencyIndex.partialFilterExpression?.client_message_id?.$type !== 'string')
    ) {
      throw new Error('Existing message idempotency index is incompatible')
    }

    if (!hasSearchIndex) {
      console.log('Creating compound text index for messages...')
      await this.messages.createIndex({ conversation_id: 1, content: 'text' }, { default_language: 'none' })
    }

    if (!hasTimelineIndex) {
      console.log('Creating timeline index for messages...')
      await this.messages.createIndex({ conversation_id: 1, send_at: -1 })
    }

    if (!hasContextIndex) {
      console.log('Creating context index for messages...')
      await this.messages.createIndex(
        { conversation_id: 1, status: 1, _id: 1 },
        { name: 'conversation_status_message_id' }
      )
    }

    if (!hasIdempotencyIndex) {
      await this.messages.createIndex(
        { sender_id: 1, client_message_id: 1 },
        {
          name: 'message_sender_client_id_unique',
          unique: true,
          partialFilterExpression: { client_message_id: { $type: 'string' } }
        }
      )
    }
  }

  private async indexConversationReadStates() {
    await Promise.all([
      this.conversationReadStates.createIndex(
        { conversation_id: 1, user_id: 1 },
        { name: 'conversation_read_state_unique', unique: true }
      ),
      this.conversationReadStates.createIndex(
        { user_id: 1, unread_message_count: 1 },
        { name: 'conversation_read_state_user_unread' }
      )
    ])
  }

  private async indexUserMessageStates() {
    await this.userMessageStates.createIndex(
      { user_id: 1 },
      { name: 'user_message_state_user_unique', unique: true }
    )
  }

  private async verifyConversationReadStateBaseline() {
    const [legacyMessage, anyMessage, anyConversationState, anyUserState] = await Promise.all([
      this.messages.findOne({ read_by: { $exists: true } }, { projection: { _id: 1 } }),
      this.messages.findOne({}, { projection: { _id: 1 } }),
      this.conversationReadStates.findOne({}, { projection: { _id: 1 } }),
      this.userMessageStates.findOne({}, { projection: { _id: 1 } })
    ])
    if (legacyMessage) {
      throw new Error(
        'Conversation read-state v2 requires a local reset: messages containing legacy read_by are not supported'
      )
    }
    if ((anyMessage && (!anyConversationState || !anyUserState)) || (anyUserState && !anyConversationState)) {
      throw new Error(
        'Conversation read-state baseline is inconsistent; reset messages, conversationReadStates and userMessageStates together'
      )
    }
  }

  private async indexGroupConversations() {
    await this.groupConversations.createIndex({ 'members.user_id': 1, _id: -1 }, { name: 'members.user_id_1__id_-1' })
  }

  private async indexNotifications() {
    const notificationIndexes = await this.listIndexesSafely(this.notifications)
    const isCompatibleIndex = (key: Record<string, unknown>, expectedKey: Record<string, number>) =>
      Object.keys(key).length === Object.keys(expectedKey).length &&
      Object.entries(expectedKey).every(([field, direction]) => key[field] === direction)
    const findIndex = (expectedKey: Record<string, number>) =>
      notificationIndexes.find((index) => isCompatibleIndex(index.key, expectedKey))
    const hasTimelineIndex = notificationIndexes.some(
      (index) =>
        isCompatibleIndex(index.key, { recipient_id: 1, created_at: -1 }) &&
        index.unique !== true &&
        index.sparse !== true &&
        !index.partialFilterExpression
    )
    const tupleTimelineIndex = findIndex({ recipient_id: 1, created_at: -1, _id: -1 })
    const deduplicationIndex = findIndex({ deduplication_key: 1 })
    const targetIndex = findIndex({ target_type: 1, target_id: 1 })
    const unreadTimelineIndex = findIndex({ recipient_id: 1, is_read: 1, created_at: -1 })
    const activeAggregationIndex = findIndex({ recipient_id: 1, aggregation_key: 1 })
    const lifecycleRelationshipIndex = findIndex({ recipient_id: 1, sender_id: 1, _id: 1 })

    if (
      tupleTimelineIndex &&
      (tupleTimelineIndex.unique === true ||
        tupleTimelineIndex.sparse === true ||
        Boolean(tupleTimelineIndex.partialFilterExpression))
    ) {
      throw new Error('Existing notification tuple timeline index has incompatible options')
    }

    const deduplicationPartialFilter = deduplicationIndex?.partialFilterExpression?.deduplication_key
    const hasCompatibleDeduplicationIndex =
      deduplicationIndex?.unique === true &&
      typeof deduplicationPartialFilter === 'object' &&
      deduplicationPartialFilter !== null &&
      '$type' in deduplicationPartialFilter &&
      deduplicationPartialFilter.$type === 'string'

    if (deduplicationIndex && !hasCompatibleDeduplicationIndex) {
      throw new Error('Existing notification deduplication index is not unique partial-on-string')
    }

    if (
      targetIndex &&
      (targetIndex.unique === true || targetIndex.sparse === true || targetIndex.partialFilterExpression)
    ) {
      throw new Error('Existing notification target index has incompatible options')
    }

    const activeAggregationFilter = activeAggregationIndex?.partialFilterExpression?.aggregation_active
    if (activeAggregationIndex && (activeAggregationIndex.unique !== true || activeAggregationFilter !== true)) {
      throw new Error('Existing active notification aggregation index is incompatible')
    }
    const unreadPartialFilter = unreadTimelineIndex?.partialFilterExpression
    if (
      unreadTimelineIndex &&
      (unreadTimelineIndex.unique === true ||
        unreadPartialFilter?.is_read !== false ||
        unreadPartialFilter?.invalidated_at !== null)
    ) {
      throw new Error('Existing notification unread timeline index is incompatible')
    }
    const hasUnreadIndex = notificationIndexes.some(
      (index) =>
        isCompatibleIndex(index.key, { recipient_id: 1, is_read: 1 }) &&
        index.unique !== true &&
        index.sparse !== true &&
        !index.partialFilterExpression
    )

    if (!hasTimelineIndex) {
      console.log('Creating notification timeline index...')
      await this.notifications.createIndex({ recipient_id: 1, created_at: -1 })
    }

    if (!hasUnreadIndex) {
      console.log('Creating notification unread index...')
      await this.notifications.createIndex({ recipient_id: 1, is_read: 1 })
    }

    if (!tupleTimelineIndex) {
      console.log('Creating notification tuple timeline index...')
      await this.notifications.createIndex(
        { recipient_id: 1, created_at: -1, _id: -1 },
        { name: 'notification_recipient_created_at_id_v2' }
      )
    }

    if (!deduplicationIndex) {
      console.log('Creating notification deduplication index...')
      await this.notifications.createIndex(
        { deduplication_key: 1 },
        {
          name: 'notification_deduplication_key_v2',
          unique: true,
          partialFilterExpression: { deduplication_key: { $type: 'string' } }
        }
      )
    }

    if (!targetIndex) {
      console.log('Creating notification target index...')
      await this.notifications.createIndex({ target_type: 1, target_id: 1 }, { name: 'notification_target_type_id_v2' })
    }

    if (!unreadTimelineIndex) {
      await this.notifications.createIndex(
        { recipient_id: 1, is_read: 1, created_at: -1 },
        {
          name: 'notification_unread_timeline_v2',
          partialFilterExpression: { is_read: false, invalidated_at: null }
        }
      )
    }

    if (!activeAggregationIndex) {
      await this.notifications.createIndex(
        { recipient_id: 1, aggregation_key: 1 },
        {
          name: 'notification_active_aggregation_unique',
          unique: true,
          partialFilterExpression: { aggregation_active: true }
        }
      )
    }

    if (!lifecycleRelationshipIndex) {
      await this.notifications.createIndex(
        { recipient_id: 1, sender_id: 1, _id: 1 },
        { name: 'notification_recipient_sender_lifecycle' }
      )
    }
  }

  private async indexNotificationStates() {
    await this.notificationStates.createIndex(
      { recipient_id: 1 },
      { name: 'notification_state_recipient_unique', unique: true }
    )
  }

  private async indexNotificationActors() {
    await Promise.all([
      this.notificationActors.createIndex(
        { notification_id: 1, actor_id: 1 },
        { name: 'notification_actor_membership_unique', unique: true }
      ),
      this.notificationActors.createIndex(
        { notification_id: 1, created_at: -1 },
        { name: 'notification_actor_preview' }
      ),
      this.notificationActors.createIndex({ source_key: 1, created_at: -1 }, { name: 'notification_actor_source' }),
      this.notificationActors.createIndex({ actor_id: 1, _id: 1 }, { name: 'notification_actor_lifecycle' })
    ])
  }

  private async indexNotificationLifecycleGuards() {
    await this.notificationLifecycleGuards.createIndex(
      { updated_at: 1 },
      { name: 'notification_lifecycle_guard_updated_at' }
    )
  }

  private async indexRetweetRelations() {
    const indexName = 'tweet_retweet_relation_unique'
    if (await this.indexExistsSafely(this.tweets, indexName)) return
    const duplicate = await this.tweets
      .aggregate<{
        count: number
      }>([
        { $match: { type: TweetType.Retweet } },
        { $group: { _id: { user_id: '$user_id', parent_id: '$parent_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 }
      ])
      .hasNext()
    if (duplicate) {
      throw new Error(
        'Cannot create unique retweet relation index: reset the local tweets collection or database, then restart'
      )
    }
    await this.tweets.createIndex(
      { user_id: 1, parent_id: 1, type: 1 },
      {
        name: indexName,
        unique: true,
        partialFilterExpression: { type: TweetType.Retweet }
      }
    )
  }

  private async listIndexesSafely<TSchema extends object>(
    collection: Collection<TSchema>
  ): Promise<IndexDescriptionInfo[]> {
    try {
      return await collection.listIndexes().toArray()
    } catch (error: unknown) {
      if (this.isNamespaceNotFound(error)) return []
      throw error
    }
  }

  private async indexExistsSafely<TSchema extends object>(
    collection: Collection<TSchema>,
    indexName: string
  ): Promise<boolean> {
    try {
      return await collection.indexExists(indexName)
    } catch (error: unknown) {
      if (this.isNamespaceNotFound(error)) return false
      throw error
    }
  }

  private isNamespaceNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 26
  }

  private async indexOutboxEvents() {
    await this.outboxEvents.createIndex({ event_id: 1 }, { name: 'outbox_event_id_unique', unique: true })
    await this.outboxEvents.createIndex(
      { status: 1, available_at: 1, locked_at: 1 },
      { name: 'outbox_status_available_locked' }
    )
    await this.outboxEvents.createIndex(
      { aggregate_type: 1, aggregate_id: 1, occurred_at: 1 },
      { name: 'outbox_aggregate_timeline' }
    )
    await this.outboxEvents.createIndex(
      { status: 1, updated_at: 1 },
      { name: 'outbox_status_updated_at_reconciliation' }
    )
  }

  // Collections Accessors
  get users(): Collection<User> {
    return this.db.collection(envConfig.db.collections.users)
  }

  get refreshTokens(): Collection<RefreshToken> {
    return this.db.collection(envConfig.db.collections.refreshToken)
  }

  get userBlocks(): Collection<UserBlock> {
    return this.db.collection(envConfig.db.collections.userBlocks)
  }

  get followers(): Collection<Follower> {
    return this.db.collection(envConfig.db.collections.followers)
  }

  get tweets(): Collection<Tweet> {
    return this.db.collection(envConfig.db.collections.tweets)
  }

  get hashtags(): Collection<Hashtag> {
    return this.db.collection(envConfig.db.collections.hashtags)
  }

  get bookmarks(): Collection<Bookmark> {
    return this.db.collection(envConfig.db.collections.bookmarks)
  }

  get likes(): Collection<Like> {
    return this.db.collection(envConfig.db.collections.likes)
  }

  get messages(): Collection<Message> {
    return this.db.collection(envConfig.db.collections.messages)
  }

  get directConversations(): Collection<DirectConversation> {
    return this.db.collection(envConfig.db.collections.directConversations)
  }
  get groupConversations(): Collection<GroupConversation> {
    return this.db.collection(envConfig.db.collections.groupConversations)
  }

  get test() {
    return this.db.collection('test')
  }

  get medias(): Collection<MediaMetadata> {
    return this.db.collection(envConfig.db.collections.medias)
  }

  get newsFeeds(): Collection<NewsFeed> {
    return this.db.collection(envConfig.db.collections.newsFeeds)
  }

  get notifications(): Collection<Notification> {
    return this.db.collection(envConfig.db.collections.notifications || 'notifications')
  }

  get outboxEvents(): Collection<OutboxEvent> {
    return this.db.collection(envConfig.db.collections.outboxEvents)
  }

  get notificationStates(): Collection<NotificationState> {
    return this.db.collection(envConfig.db.collections.notificationStates)
  }

  get notificationActors(): Collection<NotificationActor> {
    return this.db.collection(envConfig.db.collections.notificationActors)
  }

  get notificationLifecycleGuards(): Collection<NotificationLifecycleGuard> {
    return this.db.collection(envConfig.db.collections.notificationLifecycleGuards)
  }

  get conversationReadStates(): Collection<ConversationReadState> {
    return this.db.collection(envConfig.db.collections.conversationReadStates)
  }

  get userMessageStates(): Collection<UserMessageState> {
    return this.db.collection(envConfig.db.collections.userMessageStates)
  }
}

export const databaseService = DatabaseService.getInstance()
