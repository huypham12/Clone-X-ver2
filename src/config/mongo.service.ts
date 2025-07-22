// src/services/database.service.ts

import { MongoClient, Db, Collection, ObjectId } from 'mongodb'
import { config } from 'dotenv'
import User from '~/models/schemas/User.schema'
import RefreshToken from '~/models/schemas/RefreshToken.schema'
import Follower from '~/models/schemas/Follower.schema'
import Tweet from '~/models/schemas/Tweet.schema'
import Hashtag from '~/models/schemas/Hashtag.schema'
import Bookmark from '~/models/schemas/Bookmark.schema'
import Like from '~/models/schemas/Like.schema'
import Conversation from '~/models/schemas/Conversation.schema'
import { getEnvConfig } from '~/config/getEnvConfig'

config()
getEnvConfig()

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@clone-x-ver2.qhuiotw.mongodb.net/?retryWrites=true&w=majority&appName=Clone-X-ver2`

class DatabaseService {
  private client: MongoClient
  private db: Db
  ObjectId = ObjectId

  constructor() {
    this.client = new MongoClient(uri)
    this.db = this.client.db(process.env.DB_NAME)
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
    return this.db.collection(process.env.DB_USERS_COLLECTION!)
  }

  get refreshTokens(): Collection<RefreshToken> {
    return this.db.collection(process.env.DB_REFRESH_TOKEN_COLLECTION!)
  }

  get followers(): Collection<Follower> {
    return this.db.collection(process.env.DB_FOLLOWERS_COLLECTION!)
  }

  get tweets(): Collection<Tweet> {
    return this.db.collection(process.env.DB_TWEETS_COLLECTION!)
  }

  get hashtags(): Collection<Hashtag> {
    return this.db.collection(process.env.DB_HASHTAGS_COLLECTION!)
  }

  get bookmarks(): Collection<Bookmark> {
    return this.db.collection(process.env.DB_BOOKMARKS_COLLECTION!)
  }

  get likes(): Collection<Like> {
    return this.db.collection(process.env.DB_LIKES_COLLECTION!)
  }

  get conversations(): Collection<Conversation> {
    return this.db.collection(process.env.DB_CONVERSATIONS_COLLECTION!)
  }

  get test() {
    return this.db.collection('test')
  }
}

const databaseService = new DatabaseService()
export default databaseService
