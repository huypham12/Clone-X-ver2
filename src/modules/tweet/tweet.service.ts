import { randomUUID } from 'crypto'
import { ObjectId, type ClientSession, type Filter } from 'mongodb'
import { databaseService } from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'
import redisService from '~/config/redis.service'
import { Tweet, Hashtag, Like, Bookmark, NewsFeed } from '~/schemas'
import { TweetType, TweetAudience, MediaStatus, NotificationTargetType } from '~/constants/enums'
import { getParentTweetLookupStages, getIsRetweetedLookupStages } from '~/utils/aggregation'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { TweetMentionService } from './tweet-mention.service'
import { OutboxDomainEventPublisher } from '~/modules/events/outbox.publisher'
import { DomainAggregateType, DomainEventType } from '~/modules/events/domain-event.type'
import { NotificationLifecycleGuardService } from '~/modules/notification/notification-lifecycle-guard.service'

interface CreateTweetInput {
  type: TweetType
  audience: TweetAudience
  content: string
  parent_id: string | ObjectId | null
  hashtags: string[]
  mentions: ObjectId[]
  medias: Array<string | ObjectId>
}

interface UpdateTweetInput {
  audience?: TweetAudience
  content?: string
  hashtags?: string[]
  mentions?: ObjectId[]
  medias?: Array<string | ObjectId>
}

class TweetService {
  private readonly mentionService = new TweetMentionService(databaseService)
  private readonly outboxPublisher = new OutboxDomainEventPublisher()
  private readonly lifecycleGuard = new NotificationLifecycleGuardService(databaseService)

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

  async createTweet(user_id: string, body: CreateTweetInput) {
    const { type, audience, content, parent_id, hashtags, mentions, medias } = body
    const mediaIds = await this.validateTweetMedia(user_id, medias)
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId()
    const occurredAt = new Date()
    const parentId = parent_id ? new ObjectId(parent_id) : null
    const useTweetOutbox =
      envConfig.features.notificationOutboxEnabled && envConfig.features.notificationTweetOutboxEnabled
    const useSocialAggregation =
      envConfig.features.notificationOutboxEnabled && envConfig.features.notificationSocialAggregationEnabled
    const session = databaseService.startSession()
    let transactionResult: { tweet: Tweet; finalMentions: ObjectId[]; parentOwnerId: ObjectId | null } | undefined

    try {
      transactionResult = await session.withTransaction(async () => {
        const hashtagIds = await this.processHashtags(hashtags, session)
        const finalMentions = await this.mentionService.resolve(content, mentions ?? [], actorId, session, parentId)
        const tweet = new Tweet({
          _id: tweetId,
          user_id: actorId,
          type,
          audience,
          content,
          parent_id: parentId,
          hashtags: hashtagIds,
          mentions: finalMentions,
          media_ids: mediaIds,
          created_at: occurredAt,
          updated_at: occurredAt
        })
        await databaseService.tweets.insertOne(tweet, { session })
        let parentOwnerId: ObjectId | null = null

        if (parentId) {
          const incField =
            type === TweetType.Retweet ? 'retweet_count' : type === TweetType.Comment ? 'reply_count' : 'quote_count'
          await databaseService.tweets.updateOne({ _id: parentId }, { $inc: { [incField]: 1 } }, { session })
          const parentTweet = await databaseService.tweets.findOne(
            { _id: parentId },
            { projection: { user_id: 1 }, session }
          )
          parentOwnerId = parentTweet?.user_id ?? null
        }

        await databaseService.newsFeeds.insertOne(
          new NewsFeed({ user_id: actorId, tweet_id: tweetId, created_at: occurredAt }),
          { session }
        )
        const followers = await databaseService.followers
          .find({ followed_user_id: actorId }, { projection: { follow_user_id: 1 }, session })
          .toArray()
        if (followers.length > 0) {
          await databaseService.newsFeeds.insertMany(
            followers.map(
              (follower) =>
                new NewsFeed({ user_id: follower.follow_user_id, tweet_id: tweetId, created_at: occurredAt })
            ),
            { session }
          )
        }

        if (type === TweetType.Retweet && useSocialAggregation && parentId) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetReposted,
              aggregate_type: DomainAggregateType.TweetInteraction,
              aggregate_id: tweetId,
              actor_id: actorId,
              occurred_at: occurredAt,
              payload: {
                relation_id: tweetId,
                tweet_id: parentId,
                source_type: 'RETWEET',
                source_id: tweetId.toHexString()
              }
            },
            { session }
          )
        } else if (useTweetOutbox) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetCreated,
              aggregate_type: DomainAggregateType.Tweet,
              aggregate_id: tweetId,
              actor_id: actorId,
              occurred_at: occurredAt,
              payload: {
                tweet_id: tweetId,
                tweet_type: type,
                audience,
                parent_id: parentId,
                mention_ids: finalMentions,
                source_type: 'TWEET',
                source_id: tweetId.toHexString()
              }
            },
            { session }
          )
        }
        return { tweet, finalMentions, parentOwnerId }
      })
    } catch (error: unknown) {
      if (type === TweetType.Retweet && this.isDuplicateKeyError(error)) {
        throw new HttpError('Tweet already retweeted', HTTP_STATUS.CONFLICT)
      }
      throw error
    } finally {
      await session.endSession()
    }

    if (!transactionResult) throw new Error('Tweet transaction committed without a tweet result')
    const { tweet: createdTweet } = transactionResult
    if (parentId) await redisService.del(`tweet:${parentId.toHexString()}`)

    return { ...createdTweet, _id: tweetId }
  }

  async getTweet(tweet_id: string, user_id?: string) {
    const incField = user_id ? 'user_views' : 'guest_views'

    // Tăng view count trong DB (fire and forget, không ảnh hưởng tốc độ)
    databaseService.tweets.updateOne({ _id: new ObjectId(tweet_id) }, { $inc: { [incField]: 1 } }).catch(console.error)

    // Aggregate to get full details (author, hashtags, media)
    const tweet = await databaseService.tweets
      .aggregate([
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
      ])
      .toArray()

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
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId(tweet_id)
    const likeDocument = new Like({ user_id: actorId, tweet_id: tweetId })
    const likeId = likeDocument._id
    if (!likeId) throw new Error('Like relation was created without an ID')
    const useSocialAggregation =
      envConfig.features.notificationOutboxEnabled && envConfig.features.notificationSocialAggregationEnabled
    const session = databaseService.startSession()
    let like: Like | null = null
    let created = false
    try {
      await session.withTransaction(async () => {
        const target = await databaseService.tweets.findOne({ _id: tweetId }, { projection: { user_id: 1 }, session })
        if (!target) throw new HttpError('Tweet not found', HTTP_STATUS.NOT_FOUND)
        const result = await databaseService.likes.findOneAndUpdate(
          { user_id: actorId, tweet_id: tweetId },
          { $setOnInsert: likeDocument },
          { upsert: true, returnDocument: 'after', includeResultMetadata: true, session }
        )
        like = result.value
        created = result.lastErrorObject?.upserted !== undefined
        if (!like) throw new Error('Like upsert returned no document')
        if (!created) return

        await databaseService.tweets.updateOne({ _id: tweetId }, { $inc: { like_count: 1 } }, { session })
        if (useSocialAggregation) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetLiked,
              aggregate_type: DomainAggregateType.TweetInteraction,
              aggregate_id: likeId,
              actor_id: actorId,
              occurred_at: likeDocument.created_at,
              payload: {
                relation_id: likeId,
                tweet_id: tweetId,
                source_type: 'LIKE',
                source_id: likeId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }
    if (!like) throw new Error('Like transaction committed without a result')
    if (created) await redisService.del(`tweet:${tweet_id}`)
    return like
  }

  async unlikeTweet(user_id: string, tweet_id: string) {
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId(tweet_id)
    const useSocialAggregation =
      envConfig.features.notificationOutboxEnabled && envConfig.features.notificationSocialAggregationEnabled
    const session = databaseService.startSession()
    let removed: Like | null = null
    try {
      await session.withTransaction(async () => {
        removed = await databaseService.likes.findOneAndDelete({ user_id: actorId, tweet_id: tweetId }, { session })
        if (!removed) return
        const removedId = removed._id
        if (!removedId) throw new Error('Removed like relation has no ID')
        await databaseService.tweets.updateOne(
          { _id: tweetId },
          [{ $set: { like_count: { $max: [0, { $subtract: [{ $ifNull: ['$like_count', 0] }, 1] }] } } }],
          { session }
        )
        if (useSocialAggregation) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetUnliked,
              aggregate_type: DomainAggregateType.TweetInteraction,
              aggregate_id: removedId,
              actor_id: actorId,
              occurred_at: new Date(),
              payload: {
                relation_id: removedId,
                tweet_id: tweetId,
                source_type: 'LIKE',
                source_id: removedId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }
    if (removed) await redisService.del(`tweet:${tweet_id}`)
    return removed
  }

  async unretweet(user_id: string, tweet_id: string) {
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId(tweet_id)
    const useSocialAggregation =
      envConfig.features.notificationOutboxEnabled && envConfig.features.notificationSocialAggregationEnabled
    const session = databaseService.startSession()
    let removed: Tweet | null = null
    try {
      await session.withTransaction(async () => {
        removed = await databaseService.tweets.findOneAndDelete(
          { user_id: actorId, parent_id: tweetId, type: TweetType.Retweet },
          { session }
        )
        if (!removed) return
        const removedId = removed._id
        if (!removedId) throw new Error('Removed retweet relation has no ID')
        await databaseService.tweets.updateOne(
          { _id: tweetId },
          [{ $set: { retweet_count: { $max: [0, { $subtract: [{ $ifNull: ['$retweet_count', 0] }, 1] }] } } }],
          { session }
        )
        await databaseService.newsFeeds.deleteMany({ tweet_id: removed._id }, { session })
        if (useSocialAggregation) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetUndoRepost,
              aggregate_type: DomainAggregateType.TweetInteraction,
              aggregate_id: removedId,
              actor_id: actorId,
              occurred_at: new Date(),
              payload: {
                relation_id: removedId,
                tweet_id: tweetId,
                source_type: 'RETWEET',
                source_id: removedId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }
    if (removed) await redisService.del(`tweet:${tweet_id}`)
    return removed
  }

  async bookmarkTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.bookmarks.updateOne(
      { user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) },
      { $setOnInsert: new Bookmark({ user_id: new ObjectId(user_id), tweet_id: new ObjectId(tweet_id) }) },
      { upsert: true }
    )

    if (result.upsertedCount > 0) {
      await databaseService.tweets.updateOne({ _id: new ObjectId(tweet_id) }, { $inc: { bookmark_count: 1 } })
      await redisService.del(`tweet:${tweet_id}`)
    }

    const bookmark = await databaseService.bookmarks.findOne({
      user_id: new ObjectId(user_id),
      tweet_id: new ObjectId(tweet_id)
    })
    return bookmark
  }

  async unbookmarkTweet(user_id: string, tweet_id: string) {
    const result = await databaseService.bookmarks.findOneAndDelete({
      user_id: new ObjectId(user_id),
      tweet_id: new ObjectId(tweet_id)
    })

    if (result) {
      await databaseService.tweets.updateOne({ _id: new ObjectId(tweet_id) }, { $inc: { bookmark_count: -1 } })
      await redisService.del(`tweet:${tweet_id}`)
    }
    return result
  }

  async getBookmarks(user_id: string, cursor: string | undefined, limit: number) {
    const matchStage: Filter<Bookmark> = { user_id: new ObjectId(user_id) }
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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

    const tweets = bookmarks.map((b) => {
      const { bookmarkId, ...rest } = b
      return rest
    })

    return { tweets, next_cursor, has_next_page }
  }

  async getTweetLikes(tweet_id: string, cursor: string | undefined, limit: number) {
    const matchStage: Filter<Like> = { tweet_id: new ObjectId(tweet_id) }
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

    const users = likes.map((l) => {
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
    const matchStage: Filter<Tweet> = user_id
      ? {
          parent_id: new ObjectId(tweet_id),
          $or: [
            { audience: TweetAudience.Everyone },
            { $and: [{ audience: TweetAudience.TwitterCircle }, { user_id: new ObjectId(user_id) }] }
          ]
        }
      : { parent_id: new ObjectId(tweet_id), audience: TweetAudience.Everyone }
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
        $match: { user_id: { $nin: blockedUserIds } }
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
    ]

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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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

    const tweets = await databaseService.tweets.aggregate(pipeline).toArray()

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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
      tweets: feeds.map((feed) => {
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
    const matchStage: Filter<Tweet> = {
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(user_id)] }]
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
    const blockedList = await databaseService.userBlocks
      .find({
        $or: [{ user_id: new ObjectId(user_id) }, { blocked_user_id: new ObjectId(user_id) }]
      })
      .toArray()

    return blockedList.map((block) => (block.user_id.toString() === user_id ? block.blocked_user_id : block.user_id))
  }

  private async processHashtags(hashtags: string[], session?: ClientSession): Promise<ObjectId[]> {
    if (hashtags.length === 0) return []

    const hashtagObjectIds: ObjectId[] = []
    const normalizedNames = [...new Set(hashtags.map((hashtag) => hashtag.toLowerCase()))]

    // Tìm các hashtag đã tồn tại
    const existingHashtags = await databaseService.hashtags
      .find(
        {
          normalized_name: { $in: normalizedNames }
        },
        { session }
      )
      .toArray()

    const existingNames = existingHashtags.map((hashtag) => hashtag.normalized_name)
    const newNames = normalizedNames.filter((name) => !existingNames.includes(name))

    // Cập nhật post_count cho các hashtag đã tồn tại
    if (existingNames.length > 0) {
      await databaseService.hashtags.updateMany(
        { normalized_name: { $in: existingNames } },
        { $inc: { post_count: 1 } },
        { session }
      )
      hashtagObjectIds.push(...existingHashtags.map((h) => h._id))
    }

    // Insert mới các hashtag chưa có
    if (newNames.length > 0) {
      const newHashtagDocs = newNames.map(
        (name) =>
          new Hashtag({
            normalized_name: name,
            post_count: 1
          })
      )

      const insertResult = await databaseService.hashtags.insertMany(newHashtagDocs, { session })
      Object.values(insertResult.insertedIds).forEach((id) => {
        hashtagObjectIds.push(id)
      })
    }

    return hashtagObjectIds
  }

  async updateTweet(user_id: string, tweet_id: string, body: UpdateTweetInput) {
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId(tweet_id)
    const mediaIds = body.medias !== undefined ? await this.validateTweetMedia(user_id, body.medias) : undefined
    const useNotificationOutbox = envConfig.features.notificationOutboxEnabled
    const createTweetNotifications = envConfig.features.notificationTweetOutboxEnabled
    const occurredAt = new Date()
    const session = databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        if (envConfig.features.notificationOutboxEnabled) {
          await this.lifecycleGuard.touchTarget(NotificationTargetType.Tweet, tweetId, occurredAt, session)
        }
        const tweet = await databaseService.tweets.findOne({ _id: tweetId }, { session })
        if (!tweet) throw new Error('Tweet not found')
        if (!tweet.user_id.equals(actorId)) throw new Error('You do not have permission to edit this tweet')

        if (useNotificationOutbox && body.audience !== undefined && tweet.audience !== body.audience) {
          if (body.audience === TweetAudience.Everyone) {
            await this.lifecycleGuard.markTargetRestored(NotificationTargetType.Tweet, tweetId, occurredAt, session)
          } else if (tweet.audience === TweetAudience.Everyone) {
            await this.lifecycleGuard.markTargetHidden(NotificationTargetType.Tweet, tweetId, occurredAt, session)
          }
        }

        const updateData: Partial<Tweet> = { updated_at: occurredAt }
        if (body.audience !== undefined) updateData.audience = body.audience
        if (body.content !== undefined) {
          if (tweet.type === TweetType.Retweet) throw new Error('Retweet cannot have content')
          updateData.content = body.content
        }
        if (body.hashtags !== undefined) updateData.hashtags = await this.processHashtags(body.hashtags, session)
        if (mediaIds !== undefined) updateData.medias = mediaIds

        let currentMentions = tweet.mentions
        if (body.mentions !== undefined) {
          if (tweet.type === TweetType.Retweet) throw new Error('Retweet cannot have mentions')
          currentMentions = await this.mentionService.resolve(
            body.content !== undefined ? body.content : tweet.content,
            body.mentions,
            actorId,
            session,
            tweet.parent_id ?? tweetId
          )
          updateData.mentions = currentMentions
        }

        await databaseService.tweets.updateOne({ _id: tweetId }, { $set: updateData }, { session })
        const previousMentionIds = new Map(tweet.mentions.map((id) => [id.toHexString(), id]))
        const currentMentionMap = new Map(currentMentions.map((id) => [id.toHexString(), id]))
        const addedMentionIds = [...currentMentionMap.entries()]
          .filter(([id]) => !previousMentionIds.has(id))
          .map(([, id]) => id)
        const removedMentionIds = [...previousMentionIds.entries()]
          .filter(([id]) => !currentMentionMap.has(id))
          .map(([, id]) => id)
        const visibilityRevoked =
          tweet.audience === TweetAudience.Everyone &&
          body.audience !== undefined &&
          body.audience !== TweetAudience.Everyone

        if (
          useNotificationOutbox &&
          ((createTweetNotifications && addedMentionIds.length > 0) ||
            removedMentionIds.length > 0 ||
            visibilityRevoked)
        ) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetMentionsChanged,
              aggregate_type: DomainAggregateType.Tweet,
              aggregate_id: tweetId,
              actor_id: actorId,
              occurred_at: occurredAt,
              payload: {
                tweet_id: tweetId,
                added_mention_ids: createTweetNotifications ? addedMentionIds : [],
                removed_mention_ids: removedMentionIds,
                current_mention_ids: currentMentions,
                visibility_revoked: visibilityRevoked,
                source_type: 'TWEET',
                source_id: tweetId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }

    await redisService.del(`tweet:${tweet_id}`)
    return this.getTweet(tweet_id, user_id)
  }

  async deleteTweet(user_id: string, tweet_id: string) {
    const actorId = new ObjectId(user_id)
    const tweetId = new ObjectId(tweet_id)
    const occurredAt = new Date()
    const session = databaseService.startSession()
    let parentIdString: string | null = null
    try {
      await session.withTransaction(async () => {
        if (envConfig.features.notificationOutboxEnabled) {
          await this.lifecycleGuard.markTargetHidden(NotificationTargetType.Tweet, tweetId, occurredAt, session)
        }
        const tweet = await databaseService.tweets.findOne({ _id: tweetId }, { session })
        if (!tweet) throw new Error('Tweet not found')
        if (!tweet.user_id.equals(actorId)) throw new Error('You do not have permission to delete this tweet')
        parentIdString = tweet.parent_id?.toHexString() ?? null

        const deleted = await databaseService.tweets.deleteOne({ _id: tweetId, user_id: actorId }, { session })
        if (deleted.deletedCount !== 1) throw new Error('Tweet state changed before it could be deleted')
        await Promise.all([
          databaseService.likes.deleteMany({ tweet_id: tweetId }, { session }),
          databaseService.bookmarks.deleteMany({ tweet_id: tweetId }, { session }),
          databaseService.newsFeeds.deleteMany({ tweet_id: tweetId }, { session })
        ])

        if (tweet.parent_id) {
          const incField =
            tweet.type === TweetType.Retweet
              ? 'retweet_count'
              : tweet.type === TweetType.Comment
                ? 'reply_count'
                : 'quote_count'
          await databaseService.tweets.updateOne({ _id: tweet.parent_id }, { $inc: { [incField]: -1 } }, { session })
        }

        if (envConfig.features.notificationOutboxEnabled) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.TweetDeleted,
              aggregate_type: DomainAggregateType.Tweet,
              aggregate_id: tweetId,
              actor_id: actorId,
              occurred_at: occurredAt,
              payload: {
                tweet_id: tweetId,
                tweet_type: tweet.type,
                parent_id: tweet.parent_id,
                source_type: 'TWEET',
                source_id: tweetId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }

    await redisService.del(`tweet:${tweet_id}`)
    if (parentIdString) await redisService.del(`tweet:${parentIdString}`)
    return true
  }

  private isDuplicateKeyError(error: unknown): error is { code: number } {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  }
}

const tweetService = new TweetService()
export default tweetService
