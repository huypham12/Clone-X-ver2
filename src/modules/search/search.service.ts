import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'

class SearchService {
  private databaseService: DatabaseService

  constructor() {
    this.databaseService = new DatabaseService()
  }

  async searchUsers(q: string, page: number, limit: number) {
    const cacheKey = `search:users:${q}:page:${page}:limit:${limit}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const regex = new RegExp(q, 'i')
    const skip = (page - 1) * limit

    const users = await this.databaseService.users
      .find({
        $or: [{ name: { $regex: regex } }, { username: { $regex: regex } }]
      })
      .project({ password: 0, email_verify_token: 0, forgot_password_token: 0 })
      .skip(skip)
      .limit(limit)
      .toArray()

    const total = await this.databaseService.users.countDocuments({
      $or: [{ name: { $regex: regex } }, { username: { $regex: regex } }]
    })

    const result = { users, total, page, totalPages: Math.ceil(total / limit) }
    
    // Cache for 60 seconds
    await redisService.clientInstance.setEx(cacheKey, 60, JSON.stringify(result))

    return result
  }

  async searchTweets(q: string, type: 'all' | 'media', page: number, limit: number) {
    const cacheKey = `search:tweets:${q}:type:${type}:page:${page}:limit:${limit}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const skip = (page - 1) * limit
    const filter: any = { $text: { $search: q } }

    if (type === 'media') {
      filter.medias = { $exists: true, $not: { $size: 0 } }
    }

    const tweets = await this.databaseService.tweets
      .find(filter)
      .project({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(limit)
      .toArray()

    const total = await this.databaseService.tweets.countDocuments(filter)

    const result = { tweets, total, page, totalPages: Math.ceil(total / limit) }

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
}

const searchService = new SearchService()
export default searchService
