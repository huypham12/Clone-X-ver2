import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import redisService from '~/config/redis.service'
import { Tweet, Hashtag, Like, Bookmark, NewsFeed } from '~/schemas'
import { TweetType, NotificationType } from '~/constants/enums'
import notificationService from '../notification/notification.service'

const databaseService = new DatabaseService()

class TweetService {
  async createTweet(user_id: string, body: any) {
    const { type, audience, content, parent_id, hashtags, mentions, medias } = body

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
      media_ids: medias
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

    // Kiểm tra cache Redis
    const cachedTweet = await redisService.get(`tweet:${tweet_id}`)
    if (cachedTweet) {
      return cachedTweet
    }

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
          localField: 'media_ids',
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
      }
    ]).toArray()

    const tweetDetail = tweet[0] || null

    if (tweetDetail) {
      // Lưu vào Redis (TTL 1 tiếng)
      await redisService.set(`tweet:${tweet_id}`, tweetDetail, 3600)
    }

    return tweetDetail
  }

  async likeTweet(user_id: string, tweet_id: string) {
    const like = await databaseService.likes.findOneAndUpdate(
      { user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) },
      { $setOnInsert: new Like({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }) },
      { upsert: true, returnDocument: 'after' }
    )
    
    // update like count in tweet
    await databaseService.tweets.updateOne(
      { _id: new ObjectId(tweet_id) },
      { $inc: { like_count: 1 } }
    )
    
    // Create Notification
    const tweet = await databaseService.tweets.findOne({ _id: new ObjectId(tweet_id) })
    if (tweet && tweet.user_id.toString() !== user_id && like) { // we don't need to check like.value if the driver returns the document directly
      await notificationService.createNotification(
        tweet.user_id.toString(),
        user_id,
        NotificationType.Like,
        tweet_id
      )
    }

    await redisService.del(`tweet:${tweet_id}`)
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

  async bookmarkTweet(user_id: string, tweet_id: string) {
    const bookmark = await databaseService.bookmarks.findOneAndUpdate(
      { user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) },
      { $setOnInsert: new Bookmark({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }) },
      { upsert: true, returnDocument: 'after' }
    )
    
    // update bookmark count in tweet
    await databaseService.tweets.updateOne(
      { _id: new ObjectId(tweet_id) },
      { $inc: { bookmark_count: 1 } }
    )
    await redisService.del(`tweet:${tweet_id}`)
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

  async getTweetChildren({
    tweet_id,
    page,
    limit,
    user_id
  }: {
    tweet_id: string
    page: number
    limit: number
    user_id?: string
  }) {
    const blockedUserIds = await this.getBlockedUserIds(user_id)
    
    const tweets = await databaseService.tweets
      .aggregate([
        { $match: { parent_id: new ObjectId(tweet_id) } },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'author'
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
        { $sort: { created_at: -1 } },
        { $skip: limit * (page - 1) },
        { $limit: limit }
      ])
      .toArray()
      
    const total = await databaseService.tweets.countDocuments({ parent_id: new ObjectId(tweet_id) })
    return {
      tweets,
      total_page: Math.ceil(total / limit)
    }
  }

  async getNewFeeds({ user_id, page, limit }: { user_id: string; page: number; limit: number }) {
    const blockedUserIds = await this.getBlockedUserIds(user_id)
    
    const feeds = await databaseService.newsFeeds
      .aggregate([
        { $match: { user_id: new ObjectId(user_id) } },
        { $sort: { created_at: -1 } },
        { $skip: limit * (page - 1) },
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
        { $replaceRoot: { newRoot: '$tweet' } } // Đưa tweet ra ngoài
      ])
      .toArray()
      
    const total = await databaseService.newsFeeds.countDocuments({ user_id: new ObjectId(user_id) })
    return {
      tweets: feeds,
      total_page: Math.ceil(total / limit)
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
}

const tweetService = new TweetService()
export default tweetService
