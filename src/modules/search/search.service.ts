import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import redisService from '~/config/redis.service'
import { getParentTweetLookupStages, getIsRetweetedLookupStages } from '~/utils/aggregation'

class SearchService {
  private databaseService: DatabaseService

  constructor(databaseService: DatabaseService = sharedDatabaseService) {
    this.databaseService = databaseService
  }

  async searchUsers(q: string, cursor: string | undefined, limit: number, user_id?: string) {
    const cacheKey = `search:users:${q}:cursor:${cursor || 'first'}:limit:${limit}`
    const cachedData = await redisService.clientInstance.get(cacheKey)

    let result: any
    if (cachedData) {
      result = JSON.parse(cachedData)
    } else {
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

      result = { users, next_cursor, has_next_page }

      // Cache for 60 seconds
      await redisService.clientInstance.setEx(cacheKey, 60, JSON.stringify(result))
    }

    if (user_id) {
      const following = await this.databaseService.followers
        .find({ follow_user_id: new this.databaseService.ObjectId(user_id) })
        .toArray()
      const followingIds = following.map((f: any) => f.followed_user_id.toString())
      result.users = result.users.map((user: any) => ({
        ...user,
        is_following: followingIds.includes(user._id.toString())
      }))
    }

    return result
  }

  private async aggregateTweets(matchStage: any, current_user_id: string | undefined, limit: number) {
    const pipeline: any[] = [
      { $match: matchStage },
      { $sort: { _id: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'author'
        }
      },
      {
        $lookup: {
          from: 'medias',
          localField: 'medias',
          foreignField: '_id',
          as: 'medias_info'
        }
      },
      {
        $unwind: {
          path: '$author',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          'author.password': 0,
          'author.email_verify_token': 0,
          'author.forgot_password_token': 0
        }
      },
      ...getParentTweetLookupStages(current_user_id)
    ]

    if (current_user_id) {
      pipeline.push(
        ...getIsRetweetedLookupStages(current_user_id),
        {
          $lookup: {
            from: 'bookmarks',
            let: { tweet_id: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new this.databaseService.ObjectId(current_user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'bookmarks'
          }
        },
        {
          $lookup: {
            from: 'likes',
            let: { tweet_id: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new this.databaseService.ObjectId(current_user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'likes'
          }
        },
        {
          $addFields: {
            is_bookmarked: {
              $cond: {
                if: { $gt: [{ $size: '$bookmarks' }, 0] },
                then: true,
                else: false
              }
            },
            is_liked: {
              $cond: {
                if: { $gt: [{ $size: '$likes' }, 0] },
                then: true,
                else: false
              }
            }
          }
        },
        {
          $project: {
            bookmarks: 0,
            likes: 0
          }
        }
      )
    }

    const tweets = await this.databaseService.tweets.aggregate(pipeline).toArray()

    const has_next_page = tweets.length === limit
    const next_cursor = has_next_page ? tweets[tweets.length - 1]._id?.toString() : null

    return { tweets, next_cursor, has_next_page }
  }

  async searchTweets(q: string, type: 'all' | 'media', cursor: string | undefined, limit: number, user_id?: string) {
    const cacheKey = `search:tweets:${q}:type:${type}:cursor:${cursor || 'first'}:limit:${limit}:user:${user_id || 'none'}`
    const cachedData = await redisService.clientInstance.get(cacheKey)
    if (cachedData) return JSON.parse(cachedData)

    const regex = new RegExp(q, 'i')
    const filter: any = {
      content: { $regex: regex },
      $or: [
        { audience: 0 },
        { $and: [{ audience: 1 }, { user_id: user_id ? new this.databaseService.ObjectId(user_id) : null }] }
      ]
    }

    if (type === 'media') {
      filter.medias = { $exists: true, $not: { $size: 0 } }
    }

    if (cursor) {
      filter._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    const result = await this.aggregateTweets(filter, user_id, limit)

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

  async getHashtagTweets(tag: string, cursor: string | undefined, limit: number, user_id?: string) {
    const normalizedTag = tag.startsWith('#') ? tag.slice(1).toLowerCase() : tag.toLowerCase()
    const hashtag = await this.databaseService.hashtags.findOne({ normalized_name: normalizedTag })
    if (!hashtag) return { tweets: [], next_cursor: null, has_next_page: false }

    const matchStage: any = {
      hashtags: hashtag._id,
      $or: [
        { audience: 0 },
        { $and: [{ audience: 1 }, { user_id: user_id ? new this.databaseService.ObjectId(user_id) : null }] }
      ]
    }
    if (cursor) {
      matchStage._id = { $lt: new this.databaseService.ObjectId(cursor) }
    }

    return await this.aggregateTweets(matchStage, user_id, limit)
  }
}

const searchService = new SearchService()
export default searchService
