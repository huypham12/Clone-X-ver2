import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import { Tweet, Hashtag, Like, Bookmark, NewsFeed } from '~/schemas'
import { TweetType, NotificationType, TweetAudience, MediaStatus } from '~/constants/enums'
import notificationService from '../notification/notification.service'
import { getParentTweetLookupStages, getIsRetweetedLookupStages } from '~/utils/aggregation'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'

const databaseService = new DatabaseService()

class TweetService {
  private async validateTweetMedia(user_id: string, medias: Array<string | ObjectId> = []) {
    const mediaIds = medias.map((id) => new ObjectId(id))
    if (mediaIds.length === 0) return mediaIds

    const mediaDocuments = await databaseService.medias.find({ _id: { $in: mediaIds } }).toArray()

    if (mediaDocuments.length !== mediaIds.length) {
      throw new HttpError('MEDIA_NOT_FOUND', HTTP_STATUS.BAD_REQUEST)
    }

    if (mediaDocuments.some((media) => media.uploaded_by?.toString() !== user_id)) {
      throw new HttpError('MEDIA_FORBIDDEN', HTTP_STATUS.FORBIDDEN)
    }

    if (mediaDocuments.some((media) => media.status === MediaStatus.Failed)) {
      throw new HttpError('MEDIA_PROCESSING_FAILED', HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    if (mediaDocuments.some((media) => media.status !== MediaStatus.Ready || !media.url)) {
      throw new HttpError('MEDIA_NOT_READY', HTTP_STATUS.CONFLICT)
    }

    return mediaIds
  }

  async createTweet(user_id: string, body: any) {
    const { type, audience, content, parent_id, hashtags, mentions, medias } = body
    const mediaIds = await this.validateTweetMedia(user_id, medias)

    const hashtagIds = await this.processHashtags(hashtags)
    
    // Parse Mentions from content
    const parsedUsernames = content?.match(/@(\w+)/g)?.map((m: string) => m.slice(1)) || []
    let finalMentions = [...(mentions || [])]
    if (parsedUsernames.length > 0) {
      const mentionedUsers = await databaseService.users
        .find({ username: { $in: parsedUsernames } })
        .toArray()
      finalMentions = [...new Set([...finalMentions, ...mentionedUsers.map(u => u._id.toString())])]
    }

    const tweet = new Tweet({
      user_id: new ObjectId(user_id),
      type,
      audience,
      content,
      parent_id,
      hashtags: hashtagIds,
      mentions: finalMentions.map(id => new ObjectId(id)),
      media_ids: mediaIds
    })

    const result = await databaseService.tweets.insertOne(tweet)
    const tweet_id = result.insertedId

    // 1. Tăng biến đếm của tweet cha nếu có & Gửi thông báo
    if (parent_id) {
      const incField =
        type === TweetType.Retweet ? 'retweet_count' : type === TweetType.Comment ? 'reply_count' : 'quote_count'

      await databaseService.tweets.updateOne({ _id: new ObjectId(parent_id) }, { $inc: { [incField]: 1 } })
      
      // Xóa cache của parent tweet
      await redisService.del(`tweet:${parent_id}`)

      // Lấy owner của parent tweet để gửi thông báo
      const parentTweet = await databaseService.tweets.findOne({ _id: new ObjectId(parent_id) })
      if (parentTweet && parentTweet.user_id.toString() !== user_id) {
        let notiType = NotificationType.Reply
        if (type === TweetType.Retweet) notiType = NotificationType.Retweet
        if (type === TweetType.QuoteTweet) notiType = NotificationType.Quote

        await notificationService.createNotification(
          parentTweet.user_id.toString(),
          user_id,
          notiType,
          tweet_id.toString()
        )
      }
    }

    // Gửi thông báo Mention
    for (const mentionId of finalMentions) {
      if (mentionId !== user_id) {
        await notificationService.createNotification(
          mentionId.toString(),
          user_id,
          NotificationType.Mention,
          tweet_id.toString()
        )
      }
    }

    // 2. Thêm vào NewsFeed của người dùng tạo tweet
    await databaseService.newsFeeds.insertOne(
      new NewsFeed({
        user_id: new ObjectId(user_id),
        tweet_id,
        created_at: new Date()
      })
    )

    // 3. Thực hiện Fan-out: đẩy tweet vào newsfeed của những người theo dõi user này
    const followers = await databaseService.followers
      .find({ followed_user_id: new ObjectId(user_id) })
      .toArray()
      
    if (followers.length > 0) {
      const newsFeeds = followers.map(
        (follower) =>
          new NewsFeed({
            user_id: follower.follow_user_id,
            tweet_id,
            created_at: new Date()
          })
      )
      await databaseService.newsFeeds.insertMany(newsFeeds)
    }

    return { ...tweet, _id: tweet_id }
  }

  async getTweet(tweet_id: string, user_id?: string) {
    const incField = user_id ? 'user_views' : 'guest_views'
    
    // Tăng view count trong DB (fire and forget, không ảnh hưởng tốc độ)
    databaseService.tweets.updateOne(
      { _id: new ObjectId(tweet_id) },
      { $inc: { [incField]: 1 } }
    ).catch(console.error)

    // Aggregate to get full details (author, hashtags, media)
    const tweet = await databaseService.tweets.aggregate([
      { $match: { _id: new ObjectId(tweet_id) } },
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
          from: 'hashtags',
          localField: 'hashtags',
          foreignField: '_id',
          as: 'hashtags_info'
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
      ...getParentTweetLookupStages(user_id),
      ...getIsRetweetedLookupStages(user_id ?? null)
    ]).toArray()

    const tweetDetail: any = tweet[0] || null

    if (tweetDetail && user_id) {
      const [bookmark, like] = await Promise.all([
        databaseService.bookmarks.findOne({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }),
        databaseService.likes.findOne({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) })
      ])
      tweetDetail.is_bookmarked = Boolean(bookmark)
      tweetDetail.is_liked = Boolean(like)
    }

    if (tweetDetail?.audience === 1) {
      if (!user_id || tweetDetail.user_id.toString() !== user_id) {
        return null
      }
    }

    return tweetDetail
  }

  async likeTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.likes.updateOne(
      { user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) },
      { $setOnInsert: new Like({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }) },
      { upsert: true }
    )
    
    if (result.upsertedCount > 0) {
      // update like count in tweet
      await databaseService.tweets.updateOne(
        { _id: new ObjectId(tweet_id) },
        { $inc: { like_count: 1 } }
      )

      // Create Notification
      const tweet = await databaseService.tweets.findOne({ _id: new ObjectId(tweet_id) })
      if (tweet && tweet.user_id.toString() !== user_id) {
        await notificationService.createNotification(
          tweet.user_id.toString(),
          user_id,
          NotificationType.Like,
          tweet_id
        )
      }
      await redisService.del(`tweet:${tweet_id}`)
    }

    const like = await databaseService.likes.findOne({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) })
    return like
  }

  async unlikeTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.likes.findOneAndDelete({
      user_id: new ObjectId(user_id),
      tweet_id: new ObjectId(tweet_id)
    })
    
    if (result) {
      await databaseService.tweets.updateOne(
        { _id: new ObjectId(tweet_id) },
        { $inc: { like_count: -1 } }
      )
      await redisService.del(`tweet:${tweet_id}`)
    }
    return result
  }

  async unretweet(user_id: string, tweet_id: string) {
    const result = await databaseService.tweets.findOneAndDelete({
      user_id: new ObjectId(user_id),
      parent_id: new ObjectId(tweet_id),
      type: TweetType.Retweet
    })
    
    if (result) {
      await databaseService.tweets.updateOne(
        { _id: new ObjectId(tweet_id) },
        { $inc: { retweet_count: -1 } }
      )
      
      // Clear cache of the parent tweet
      await redisService.del(`tweet:${tweet_id}`)
      
      // Remove from NewsFeed
      await databaseService.newsFeeds.deleteMany({
        tweet_id: result._id
      })
    }
    return result
  }

  async bookmarkTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.bookmarks.updateOne(
      { user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) },
      { $setOnInsert: new Bookmark({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }) },
      { upsert: true }
    )
    
    if (result.upsertedCount > 0) {
      await databaseService.tweets.updateOne(
        { _id: new ObjectId(tweet_id) },
        { $inc: { bookmark_count: 1 } }
      )
      await redisService.del(`tweet:${tweet_id}`)
    }

    const bookmark = await databaseService.bookmarks.findOne({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) })
    return bookmark
  }

  async unbookmarkTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.bookmarks.findOneAndDelete({
      user_id: new ObjectId(user_id),
      tweet_id: new ObjectId(tweet_id)
    })
    
    if (result) {
      await databaseService.tweets.updateOne(
        { _id: new ObjectId(tweet_id) },
        { $inc: { bookmark_count: -1 } }
      )
      await redisService.del(`tweet:${tweet_id}`)
    }
    return result
  }

  async getBookmarks(user_id: string, cursor: string | undefined, limit: number) {
    const matchStage: any = { user_id: new ObjectId(user_id) }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    const bookmarks = await databaseService.bookmarks
      .aggregate([
        { $match: matchStage },
        { $sort: { _id: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'tweets',
            localField: 'tweet_id',
            foreignField: '_id',
            as: 'tweet'
          }
        },
        { $unwind: '$tweet' },
        {
          $lookup: {
            from: 'users',
            localField: 'tweet.user_id',
            foreignField: '_id',
            as: 'tweet.author'
          }
        },
        {
          $lookup: {
            from: 'medias',
            localField: 'tweet.medias',
            foreignField: '_id',
            as: 'tweet.medias_info'
          }
        },
        {
          $unwind: {
            path: '$tweet.author',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            'tweet.author.password': 0,
            'tweet.author.email_verify_token': 0,
            'tweet.author.forgot_password_token': 0
          }
        },
        ...getParentTweetLookupStages(user_id, 'tweet'),
        ...getIsRetweetedLookupStages(user_id, 'tweet'),
        {
          $lookup: {
            from: 'bookmarks',
            let: { tweet_id: '$tweet._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new ObjectId(user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'tweet.bookmarks'
          }
        },
        {
          $lookup: {
            from: 'likes',
            let: { tweet_id: '$tweet._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new ObjectId(user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'tweet.likes'
          }
        },
        {
          $addFields: {
            'tweet.is_bookmarked': {
              $cond: {
                if: { $gt: [{ $size: '$tweet.bookmarks' }, 0] },
                then: true,
                else: false
              }
            },
            'tweet.is_liked': {
              $cond: {
                if: { $gt: [{ $size: '$tweet.likes' }, 0] },
                then: true,
                else: false
              }
            }
          }
        },
        {
          $project: {
            'tweet.bookmarks': 0,
            'tweet.likes': 0
          }
        },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$tweet', { bookmarkId: '$_id' }] } } }
      ])
      .toArray()

    const has_next_page = bookmarks.length === limit
    const next_cursor = has_next_page ? bookmarks[bookmarks.length - 1].bookmarkId?.toString() : null

    const tweets = bookmarks.map(b => {
      const { bookmarkId, ...rest } = b
      return rest
    })

    return { tweets, next_cursor, has_next_page }
  }

  async getTweetLikes(tweet_id: string, cursor: string | undefined, limit: number) {
    const matchStage: any = { tweet_id: new ObjectId(tweet_id) }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    const likes = await databaseService.likes
      .aggregate([
        { $match: matchStage },
        { $sort: { _id: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            'user.password': 0,
            'user.email_verify_token': 0,
            'user.forgot_password_token': 0
          }
        },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$user', { likeId: '$_id' }] } } }
      ])
      .toArray()

    const has_next_page = likes.length === limit
    const next_cursor = has_next_page ? likes[likes.length - 1].likeId?.toString() : null

    const users = likes.map(l => {
      const { likeId, ...rest } = l
      return rest
    })

    return { users, next_cursor, has_next_page }
  }

  async getTweetChildren({
    tweet_id,
    cursor,
    limit,
    user_id
  }: {
    tweet_id: string
    cursor?: string
    limit: number
    user_id?: string
  }) {
    const blockedUserIds = await this.getBlockedUserIds(user_id)
    const matchStage: any = { 
      parent_id: new ObjectId(tweet_id),
      $or: [
        { audience: 0 },
        { $and: [{ audience: 1 }, { user_id: user_id ? new ObjectId(user_id) : null }] }
      ]
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }
    
    const pipeline: any[] = [
        { $match: matchStage },
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
          $match: { 'user_id': { $nin: blockedUserIds } }
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
        ...getParentTweetLookupStages(user_id),
        { $sort: { _id: -1 } },
        { $limit: limit }
      ];

    if (user_id) {
      pipeline.push(
        ...getIsRetweetedLookupStages(user_id),
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
                      { $eq: ['$user_id', new ObjectId(user_id)] }
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
                      { $eq: ['$user_id', new ObjectId(user_id)] }
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
      );
    }

    const tweets = await databaseService.tweets.aggregate(pipeline).toArray();
      
    const has_next_page = tweets.length === limit
    const next_cursor = has_next_page ? tweets[tweets.length - 1]._id?.toString() : null
    
    return {
      tweets,
      next_cursor,
      has_next_page
    }
  }

  async getNewFeeds({ user_id, cursor, limit }: { user_id: string; cursor?: string; limit: number }) {
    const blockedUserIds = await this.getBlockedUserIds(user_id)
    const matchStage: any = { user_id: new ObjectId(user_id) }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }
    
    const feeds = await databaseService.newsFeeds
      .aggregate([
        { $match: matchStage },
        { $sort: { _id: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'tweets',
            localField: 'tweet_id',
            foreignField: '_id',
            as: 'tweet'
          }
        },
        {
          $match: {
            $or: [
              { 'tweet.audience': 0 },
              { $and: [{ 'tweet.audience': 1 }, { 'tweet.user_id': new ObjectId(user_id) }] }
            ]
          }
        },
        {
          $unwind: {
            path: '$tweet'
          }
        },
        {
          $match: { 'tweet.user_id': { $nin: blockedUserIds } }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'tweet.user_id',
            foreignField: '_id',
            as: 'tweet.author'
          }
        },
        {
          $lookup: {
            from: 'medias',
            localField: 'tweet.medias',
            foreignField: '_id',
            as: 'tweet.medias_info'
          }
        },
        {
          $unwind: {
            path: '$tweet.author',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            'tweet.author.password': 0,
            'tweet.author.email_verify_token': 0,
            'tweet.author.forgot_password_token': 0
          }
        },
        ...getParentTweetLookupStages(user_id, 'tweet'),
        ...getIsRetweetedLookupStages(user_id, 'tweet'),
        {
          $lookup: {
            from: 'bookmarks',
            let: { tweet_id: '$tweet._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new ObjectId(user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'tweet.bookmarks'
          }
        },
        {
          $lookup: {
            from: 'likes',
            let: { tweet_id: '$tweet._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new ObjectId(user_id)] }
                    ]
                  }
                }
              }
            ],
            as: 'tweet.likes'
          }
        },
        {
          $addFields: {
            'tweet.is_bookmarked': {
              $cond: {
                if: { $gt: [{ $size: '$tweet.bookmarks' }, 0] },
                then: true,
                else: false
              }
            },
            'tweet.is_liked': {
              $cond: {
                if: { $gt: [{ $size: '$tweet.likes' }, 0] },
                then: true,
                else: false
              }
            }
          }
        },
        {
          $project: {
            'tweet.bookmarks': 0,
            'tweet.likes': 0
          }
        },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$tweet', { newsFeedId: '$_id' }] } } }
      ])
      .toArray()
      
    const has_next_page = feeds.length === limit
    const next_cursor = has_next_page ? feeds[feeds.length - 1].newsFeedId?.toString() : null
    
    return {
      tweets: feeds.map(feed => {
        const { newsFeedId, ...rest } = feed
        return rest
      }),
      next_cursor,
      has_next_page
    }
  }

  async getForYouFeeds({ user_id, cursor, limit }: { user_id: string; cursor?: string; limit: number }) {
    const blockedUserIds = await this.getBlockedUserIds(user_id)
    
    // For You: Latest tweets globally, excluding retweets and comments, from users not blocked
    const matchStage: any = { 
      user_id: { $nin: blockedUserIds },
      type: { $in: [TweetType.Tweet, TweetType.QuoteTweet] },
      audience: TweetAudience.Everyone
    }

    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }
    
    const tweets = await databaseService.tweets
      .aggregate([
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
        ...getParentTweetLookupStages(user_id),
        ...getIsRetweetedLookupStages(user_id),
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
                      { $eq: ['$user_id', new ObjectId(user_id)] }
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
                      { $eq: ['$user_id', new ObjectId(user_id)] }
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
      ])
      .toArray()
      
    const has_next_page = tweets.length === limit
    const next_cursor = has_next_page ? tweets[tweets.length - 1]._id?.toString() : null
    
    return {
      tweets,
      next_cursor,
      has_next_page
    }
  }

  private async getBlockedUserIds(user_id?: string): Promise<ObjectId[]> {
    if (!user_id) return []
    const blockedList = await databaseService.userBlocks.find({
      $or: [
        { user_id: new ObjectId(user_id) },
        { blocked_user_id: new ObjectId(user_id) }
      ]
    }).toArray()
    
    return blockedList.map(block => 
      block.user_id.toString() === user_id ? block.blocked_user_id : block.user_id
    )
  }

  private async processHashtags(hashtags: string[]): Promise<ObjectId[]> {
    if (hashtags.length === 0) return []

    const hashtagObjectIds: ObjectId[] = []
    
    // Tìm các hashtag đã tồn tại
    const existingHashtags = await databaseService.hashtags.find({
      normalized_name: { $in: hashtags.map(h => h.toLowerCase()) }
    }).toArray()

    const existingNames = existingHashtags.map(h => h.normalized_name)
    const newNames = hashtags.map(h => h.toLowerCase()).filter(name => !existingNames.includes(name))

    // Cập nhật post_count cho các hashtag đã tồn tại
    if (existingNames.length > 0) {
      await databaseService.hashtags.updateMany(
        { normalized_name: { $in: existingNames } },
        { $inc: { post_count: 1 } }
      )
      hashtagObjectIds.push(...existingHashtags.map(h => h._id))
    }

    // Insert mới các hashtag chưa có
    if (newNames.length > 0) {
      const newHashtagDocs = newNames.map(name => new Hashtag({
        normalized_name: name,
        post_count: 1
      }))
      
      const insertResult = await databaseService.hashtags.insertMany(newHashtagDocs)
      Object.values(insertResult.insertedIds).forEach(id => {
        hashtagObjectIds.push(id)
      })
    }

    return hashtagObjectIds
  }

  async updateTweet(user_id: string, tweet_id: string, body: any) {
    const tweet = await databaseService.tweets.findOne({ _id: new ObjectId(tweet_id) })
    if (!tweet) {
      throw new Error('Tweet not found')
    }

    if (tweet.user_id.toString() !== user_id) {
      throw new Error('You do not have permission to edit this tweet')
    }

    const updateData: any = {
      updated_at: new Date()
    }

    if (body.audience !== undefined) {
      updateData.audience = body.audience
    }

    if (body.content !== undefined) {
      if (tweet.type === TweetType.Retweet) {
        throw new Error('Retweet cannot have content')
      }
      updateData.content = body.content
    }

    if (body.hashtags !== undefined) {
      updateData.hashtags = await this.processHashtags(body.hashtags)
    }

    if (body.mentions !== undefined) {
      // Parse Mentions from content if content is provided
      const content = body.content !== undefined ? body.content : tweet.content
      const parsedUsernames = content?.match(/@(\w+)/g)?.map((m: string) => m.slice(1)) || []
      
      let finalMentions = [...body.mentions]
      if (parsedUsernames.length > 0) {
        const mentionedUsers = await databaseService.users
          .find({ username: { $in: parsedUsernames } })
          .toArray()
        finalMentions = [...new Set([...finalMentions, ...mentionedUsers.map(u => u._id)])]
      }
      updateData.mentions = finalMentions
    }

    if (body.medias !== undefined) {
      updateData.medias = await this.validateTweetMedia(user_id, body.medias)
    }

    await databaseService.tweets.updateOne(
      { _id: new ObjectId(tweet_id) },
      { $set: updateData }
    )

    await redisService.del(`tweet:${tweet_id}`)
    
    return this.getTweet(tweet_id, user_id)
  }

  async deleteTweet(user_id: string, tweet_id: string) {
    const tweet = await databaseService.tweets.findOne({ _id: new ObjectId(tweet_id) })
    if (!tweet) {
      throw new Error('Tweet not found') // Ideal to throw custom Error with HTTP status here, assuming generic error handler catches it
    }

    if (tweet.user_id.toString() !== user_id) {
      throw new Error('You do not have permission to delete this tweet')
    }

    // Xóa Tweet
    await databaseService.tweets.deleteOne({ _id: new ObjectId(tweet_id) })

    // Xóa các dữ liệu liên quan (Likes, Bookmarks, NewsFeeds)
    await Promise.all([
      databaseService.likes.deleteMany({ tweet_id: new ObjectId(tweet_id) }),
      databaseService.bookmarks.deleteMany({ tweet_id: new ObjectId(tweet_id) }),
      databaseService.newsFeeds.deleteMany({ tweet_id: new ObjectId(tweet_id) }),
      redisService.del(`tweet:${tweet_id}`)
    ])

    // Giảm đếm của tweet cha nếu có
    if (tweet.parent_id) {
      const incField =
        tweet.type === TweetType.Retweet ? 'retweet_count' : tweet.type === TweetType.Comment ? 'reply_count' : 'quote_count'
      
      await databaseService.tweets.updateOne({ _id: tweet.parent_id }, { $inc: { [incField]: -1 } })
      await redisService.del(`tweet:${tweet.parent_id}`)
    }

    return true
  }
}

const tweetService = new TweetService()
export default tweetService
