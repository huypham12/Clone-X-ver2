// src/services/database.service.ts

import { MongoClient, Db, Collection, ObjectId } from 'mongodb'
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
  Notification
} from '~/schemas'
import { envConfig } from './getEnvConfig'

const uri = `mongodb+srv://${envConfig.db.username}:${envConfig.db.password}@clone-x-ver2.qhuiotw.mongodb.net/?retryWrites=true&w=majority&appName=Clone-X-ver2`

export default class DatabaseService {
  private client: MongoClient
  private db: Db
  ObjectId = ObjectId

  constructor() {
    this.client = new MongoClient(uri)
    this.db = this.client.db(envConfig.db.name)
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

  /** Index collections — should be called once during bootstrap */
  async createIndexes() {
    await Promise.all([
      this.indexUsers(),
      this.indexRefreshTokens(),
      this.indexFollowers(),
      this.indexTweets(),
      this.indexNewsFeeds(),
      this.indexBookmarks(),
      this.indexLikes(),
      this.indexHashtags(),
      this.indexUserBlocks(),
      this.indexMessages(),
      this.indexGroupConversations(),
      this.indexNotifications()
    ])
  }

  /** Chat bootstrap indexes kept separate from unrelated legacy collections. */
  async createConversationIndexes() {
    await Promise.all([this.indexMessages(), this.indexGroupConversations(), this.indexUserBlocks()])
  }

  private async indexUsers() {
    const exists = await this.users.indexExists(['email_1', 'username_1', 'email_1_password_1'])
    if (exists) return

    console.log('Creating indexes for users...')
    await this.users.createIndex({ email: 1 }, { unique: true })
    await this.users.createIndex({ username: 1 }, { unique: true })
    await this.users.createIndex({ email: 1, password: 1 })
  }

  private async indexRefreshTokens() {
    const exists = await this.refreshTokens.indexExists(['token_1', 'exp_1'])
    if (exists) return

    console.log('Creating indexes for refresh tokens...')
    await this.refreshTokens.createIndex({ token: 1 })
    await this.refreshTokens.createIndex({ exp: 1 }, { expireAfterSeconds: 0 })
  }

  private async indexFollowers() {
    const followerIndexName = 'follow_user_id_1_followed_user_id_1'
    const legacyFollowerIndexName = 'user_id_1_followed_user_id_1'
    const [hasFollowerIndex, hasLegacyFollowerIndex] = await Promise.all([
      this.followers.indexExists(followerIndexName),
      this.followers.indexExists(legacyFollowerIndexName)
    ])

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
      const redundantIds = duplicateGroups.flatMap((group) => group.ids.slice(1))

      if (redundantIds.length > 0) {
        console.log(`Removing ${redundantIds.length} duplicate follower records...`)
        await this.followers.deleteMany({ _id: { $in: redundantIds } })
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

    if (hasLegacyFollowerIndex) {
      console.log('Removing legacy followers index...')
      await this.followers.dropIndex(legacyFollowerIndexName)
    }
  }

  private async indexTweets() {
    const exists = await this.tweets.indexExists(['content_text'])
    if (exists) return

    console.log('Creating full-text index for tweets...')
    await this.tweets.createIndex({ content: 'text' }, { default_language: 'none' })
    await this.tweets.createIndex({ parent_id: 1, created_at: -1 })
  }

  private async indexNewsFeeds() {
    const exists = await this.newsFeeds.indexExists(['user_id_1_created_at_-1'])
    if (exists) return

    console.log('Creating indexes for newsFeeds...')
    await this.newsFeeds.createIndex({ user_id: 1, created_at: -1 })
  }

  private async indexBookmarks() {
    const exists = await this.bookmarks.indexExists(['user_id_1_tweet_id_1'])
    if (exists) return

    console.log('Creating indexes for bookmarks...')
    await this.bookmarks.createIndex({ user_id: 1, tweet_id: 1 }, { unique: true })
  }

  private async indexLikes() {
    const exists = await this.likes.indexExists(['user_id_1_tweet_id_1'])
    if (exists) return

    console.log('Creating indexes for likes...')
    await this.likes.createIndex({ user_id: 1, tweet_id: 1 }, { unique: true })
  }

  private async indexHashtags() {
    const exists = await this.hashtags.indexExists(['normalized_name_1'])
    if (exists) return

    console.log('Creating indexes for hashtags...')
    await this.hashtags.createIndex({ normalized_name: 1 }, { unique: true })
  }

  private async indexUserBlocks() {
    const exists = await this.userBlocks.indexExists(['user_id_1_blocked_user_id_1'])
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
    const redundantIds = duplicateGroups.flatMap((group) => group.ids.slice(1))

    if (redundantIds.length > 0) {
      console.log(`Removing ${redundantIds.length} duplicate user block records...`)
      await this.userBlocks.deleteMany({ _id: { $in: redundantIds } })
    }

    console.log('Creating indexes for userBlocks...')
    await this.userBlocks.createIndex({ user_id: 1, blocked_user_id: 1 }, { unique: true })
  }

  private async indexMessages() {
    const [hasSearchIndex, hasTimelineIndex, hasContextIndex] = await Promise.all([
      this.messages.indexExists('conversation_id_1_content_text'),
      this.messages.indexExists('conversation_id_1_send_at_-1'),
      this.messages.indexExists('conversation_status_message_id')
    ])

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
  }

  private async indexGroupConversations() {
    await this.groupConversations.createIndex({ 'members.user_id': 1, _id: -1 })
  }

  private async indexNotifications() {
    const exists = await this.notifications.indexExists(['recipient_id_1_created_at_-1'])
    if (exists) return

    console.log('Creating indexes for notifications...')
    await this.notifications.createIndex({ recipient_id: 1, created_at: -1 })
    await this.notifications.createIndex({ recipient_id: 1, is_read: 1 })
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
}
