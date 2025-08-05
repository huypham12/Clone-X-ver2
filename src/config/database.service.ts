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
  Tweet
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
    await Promise.all([this.indexUsers(), this.indexRefreshTokens(), this.indexFollowers(), this.indexTweets()])
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
    const exists = await this.followers.indexExists(['user_id_1_followed_user_id_1'])
    if (exists) return

    console.log('Creating indexes for followers...')
    await this.followers.createIndex({ user_id: 1, followed_user_id: 1 }, { unique: true })
  }

  private async indexTweets() {
    const exists = await this.tweets.indexExists(['content_text'])
    if (exists) return

    console.log('Creating full-text index for tweets...')
    await this.tweets.createIndex({ content: 'text' }, { default_language: 'none' })
  }

  // Collections Accessors
  get users(): Collection<User> {
    return this.db.collection(envConfig.db.collections.users)
  }

  get refreshTokens(): Collection<RefreshToken> {
    return this.db.collection(envConfig.db.collections.refreshToken)
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
}
