import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'

class SearchService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  async searchUsers(q: string, cursor: string | undefined, limit: number) {
    const cacheKey = `search:users:${q}:cursor:${cursor || 'first'}:limit:${limit}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const regex = new RegExp(q, 'i')

    const filter: any = {
      $or: [{ name: { $regex: regex } }, { username: { $regex: regex } }]
    }
    
    if (cursor) {
      filter._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const users = await this.databaseService.users
      .find(filter)
      .project({ password: 0, email_verify_token: 0, forgot_password_token: 0 })
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = users.length === limit
    const next_cursor = has_next_page ? users[users.length - 1]._id.toString() : null
    
    const result = { users, next_cursor, has_next_page }
    
    // Cache for 60 seconds
    await redisService.clientInstance.setEx(cacheKey, 60, JSON.stringify(result))

    return result
  }

  async searchTweets(q: string, type: 'all' | 'media', cursor: string | undefined, limit: number) {
    const cacheKey = `search:tweets:${q}:type:${type}:cursor:${cursor || 'first'}:limit:${limit}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const filter: any = { $text: { $search: q } }

    if (type === 'media') {
      filter.media_ids = { $exists: true, $not: { $size: 0 } }
    }
    
    if (cursor) {
      filter._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const tweets = await this.databaseService.tweets
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = tweets.length === limit
    const next_cursor = has_next_page ? tweets[tweets.length - 1]._id.toString() : null

    const result = { tweets, next_cursor, has_next_page }
    
    // Cache for 60 seconds
    await redisService.clientInstance.setEx(cacheKey, 60, JSON.stringify(result))

    return result
  }

  async searchHashtags(q: string) {
    const cacheKey = `search:hashtags:${q}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const regex = new RegExp(q, 'i')
    const hashtags = await this.databaseService.hashtags
      .find({ normalized_name: { $regex: regex } })
      .limit(10)
      .toArray()

    // Cache for 5 minutes
    await redisService.clientInstance.setEx(cacheKey, 300, JSON.stringify(hashtags))

    return hashtags
  }

  async addSearchHistory(user_id: string, q: string) {
    const key = `search_history:${user_id}`
    await redisService.clientInstance.lRem(key, 0, q)
    await redisService.clientInstance.lPush(key, q)
    await redisService.clientInstance.lTrim(key, 0, 19) // Keep max 20 items
  }

  async getSearchHistory(user_id: string) {
    const key = `search_history:${user_id}`
    return await redisService.clientInstance.lRange(key, 0, -1)
  }

  async deleteSearchHistory(user_id: string) {
    const key = `search_history:${user_id}`
    await redisService.clientInstance.del(key)
  }

  async getHashtagTweets(tag: string, cursor: string | undefined, limit: number) {
    const normalizedTag = tag.startsWith('#') ? tag.slice(1).toLowerCase() : tag.toLowerCase()
    const hashtag = await this.databaseService.hashtags.findOne({ normalized_name: normalizedTag })
    if (!hashtag) return { tweets: [], next_cursor: null, has_next_page: false }

    const matchStage: any = { hashtags: hashtag._id }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const tweets = await this.databaseService.tweets
      .find(matchStage)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = tweets.length === limit
    const next_cursor = has_next_page ? tweets[tweets.length - 1]._id.toString() : null

    return { tweets, next_cursor, has_next_page }
  }
}

const searchService = new SearchService()
export default searchService
