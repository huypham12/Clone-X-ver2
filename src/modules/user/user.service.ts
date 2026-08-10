import { ObjectId } from 'mongodb'
import { randomUUID } from 'crypto'
import DatabaseService from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'
import { UserPrivateDTO, UserPublicDTO } from './dto/user.dto'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { Follower, User, UserBlock } from '~/schemas'
import { TweetType } from '~/constants/enums'
import { getParentTweetLookupStages, getIsRetweetedLookupStages } from '~/utils/aggregation'
import { getIO } from '~/socket'
import { OutboxDomainEventPublisher } from '~/modules/events/outbox.publisher'
import { DomainAggregateType, DomainEventType } from '~/modules/events/domain-event.type'
import { NotificationLifecycleGuardService } from '~/modules/notification/notification-lifecycle-guard.service'
import { UserMentionCandidateService } from './user-mention-candidate.service'

const emitBlockStatusChanged = (firstUserId: string, secondUserId: string) => {
  try {
    getIO()
      .to([firstUserId, secondUserId])
      .emit('@user:block-status-changed', {
        user_ids: [firstUserId, secondUserId]
      })
  } catch (error) {
    console.error('Could not emit user block status change:', error)
  }
}

export class UserService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxPublisher: OutboxDomainEventPublisher = new OutboxDomainEventPublisher(),
    private readonly lifecycleGuard: NotificationLifecycleGuardService = new NotificationLifecycleGuardService(
      databaseService
    ),
    private readonly mentionCandidateService: UserMentionCandidateService = new UserMentionCandidateService(
      databaseService
    )
  ) {}
  getMeInfo = async (user_id: string): Promise<UserPrivateDTO> => {
    const user = await this.databaseService.users.findOne(
      { _id: new ObjectId(user_id) },
      {
        // k trả về thông tin nhạy cảm của người dùng
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          refresh_token: 0,
          verify: 0,
          created_at: 0,
          updated_at: 0
        }
      }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }
    return user
  }

  getUserInfoByUsername = async (username: string, current_user_id?: string): Promise<UserPublicDTO> => {
    const user = await this.databaseService.users.findOne(
      { username },
      {
        projection: {
          password: 0,
          email: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          refresh_token: 0,
          verify: 0,
          created_at: 0,
          updated_at: 0
        }
      }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    let is_following = false
    let is_blocked = false
    let is_blocked_by_user = false

    if (current_user_id) {
      const [following, blocked, blockedByUser] = await Promise.all([
        this.databaseService.followers.findOne({
          follow_user_id: new ObjectId(current_user_id),
          followed_user_id: user._id
        }),
        this.databaseService.userBlocks.findOne({ user_id: new ObjectId(current_user_id), blocked_user_id: user._id }),
        this.databaseService.userBlocks.findOne({ user_id: user._id, blocked_user_id: new ObjectId(current_user_id) })
      ])
      is_following = !!following
      is_blocked = !!blocked
      is_blocked_by_user = !!blockedByUser
    }

    return { ...user, is_following, is_blocked, is_blocked_by_user }
  }

  // partial biến tất cả thuộc tính thành optional
  updateMeInfo = async (user_id: string, updateData: any): Promise<UserPrivateDTO> => {
    if (updateData.username) {
      const existing = await this.databaseService.users.findOne({ username: updateData.username })
      if (existing && existing._id?.toString() !== user_id) {
        throw new HttpError(MESSAGES.USERNAME_ALREADY_EXISTS, HTTP_STATUS.BAD_REQUEST)
      }
    }

    const user = await this.databaseService.users.findOneAndUpdate(
      { _id: new ObjectId(user_id) },
      { $set: updateData },
      {
        returnDocument: 'after',
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          refresh_token: 0
        }
      }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }
    return user
  }

  blockUser = async (user_id: string, blocked_user_id: string) => {
    // kiểm tra xem có user này không
    const user = await this.databaseService.users.findOne({ _id: new ObjectId(blocked_user_id) })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // Không cho block chính mình
    if (user._id.toString() === user_id) {
      throw new HttpError(MESSAGES.CANNOT_BLOCK_YOURSELF, HTTP_STATUS.BAD_REQUEST)
    }

    const userObjectId = new ObjectId(user_id)
    const blockedUser = new UserBlock({
      user_id: userObjectId,
      blocked_user_id: user._id
    })
    const relationId = blockedUser._id
    if (!relationId) throw new Error('Block relation was created without an ID')
    const occurredAt = new Date()
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        if (envConfig.features.notificationOutboxEnabled) {
          await this.lifecycleGuard.markUserPairBlocked(userObjectId, user._id, occurredAt, session)
        }
        const result = await this.databaseService.userBlocks.updateOne(
          { user_id: userObjectId, blocked_user_id: user._id },
          { $setOnInsert: blockedUser },
          { upsert: true, session }
        )
        if (result.upsertedCount === 0) throw new HttpError(MESSAGES.USER_BLOCKED, HTTP_STATUS.CONFLICT)

        if (envConfig.features.notificationOutboxEnabled) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.UserBlocked,
              aggregate_type: DomainAggregateType.UserRelationship,
              aggregate_id: relationId,
              actor_id: userObjectId,
              occurred_at: occurredAt,
              payload: {
                relation_id: relationId,
                blocker_id: userObjectId,
                blocked_user_id: user._id,
                source_type: 'USER_BLOCK',
                source_id: relationId.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }

    emitBlockStatusChanged(user_id, blocked_user_id)
  }

  unblockUser = async (user_id: string, blocked_user_id: string) => {
    // kiểm tra xem có user này không
    const user = await this.databaseService.users.findOne({ _id: new ObjectId(blocked_user_id) })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    const userObjectId = new ObjectId(user_id)
    const occurredAt = new Date()
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        if (envConfig.features.notificationOutboxEnabled) {
          await this.lifecycleGuard.markUserPairUnblocked(userObjectId, user._id, occurredAt, session)
        }
        const relation = await this.databaseService.userBlocks.findOne(
          { user_id: userObjectId, blocked_user_id: user._id },
          { session }
        )
        if (!relation?._id) throw new HttpError(MESSAGES.USER_NOT_BLOCKED, HTTP_STATUS.BAD_REQUEST)
        const result = await this.databaseService.userBlocks.deleteMany(
          { user_id: userObjectId, blocked_user_id: user._id },
          { session }
        )
        if (result.deletedCount === 0) throw new HttpError(MESSAGES.USER_NOT_BLOCKED, HTTP_STATUS.BAD_REQUEST)

        if (envConfig.features.notificationOutboxEnabled) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.UserUnblocked,
              aggregate_type: DomainAggregateType.UserRelationship,
              aggregate_id: relation._id,
              actor_id: userObjectId,
              occurred_at: occurredAt,
              payload: {
                relation_id: relation._id,
                blocker_id: userObjectId,
                blocked_user_id: user._id,
                source_type: 'USER_BLOCK',
                source_id: relation._id.toHexString()
              }
            },
            { session }
          )
        }
      })
    } finally {
      await session.endSession()
    }

    emitBlockStatusChanged(user_id, blocked_user_id)
  }

  getBlockedUsers = async (user_id: string): Promise<UserPublicDTO[]> => {
    const blockedUsers = await this.databaseService.userBlocks
      .find({
        user_id: new ObjectId(user_id)
      })
      .toArray()

    if (!blockedUsers || blockedUsers.length === 0) {
      return []
    }

    const userIds = blockedUsers.map((block) => block.blocked_user_id)
    const users = await this.databaseService.users
      .find(
        {
          _id: { $in: userIds }
        },
        {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            refresh_token: 0,
            verify: 0,
            created_at: 0,
            updated_at: 0
          }
        }
      )
      .toArray()

    return users
  }

  followUser = async (user_id: string, followed_user_id: string) => {
    const followerId = new ObjectId(user_id)
    const followedUserId = new ObjectId(followed_user_id)
    if (followerId.equals(followedUserId)) {
      throw new HttpError(MESSAGES.CANNOT_FOLLOW_YOURSELF, HTTP_STATUS.BAD_REQUEST)
    }
    const follower = new Follower({
      follow_user_id: followerId,
      followed_user_id: followedUserId
    })
    const useOutbox = envConfig.features.notificationOutboxEnabled && envConfig.features.notificationFollowOutboxEnabled
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        const followedUser = await this.databaseService.users.findOne(
          { _id: followedUserId },
          { projection: { _id: 1 }, session }
        )
        if (!followedUser) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

        const existingBlock = await this.databaseService.userBlocks.findOne(
          {
            $or: [
              { user_id: followerId, blocked_user_id: followedUserId },
              { user_id: followedUserId, blocked_user_id: followerId }
            ]
          },
          { projection: { _id: 1 }, session }
        )
        if (existingBlock) throw new HttpError(MESSAGES.FOLLOW_NOT_ALLOWED, HTTP_STATUS.FORBIDDEN)

        await this.databaseService.followers.insertOne(follower, { session })
        const followerCounter = await this.databaseService.users.updateOne(
          { _id: followerId },
          { $inc: { following_count: 1 } },
          { session }
        )
        if (followerCounter.matchedCount === 0) {
          throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
        }
        await this.databaseService.users.updateOne(
          { _id: followedUserId },
          { $inc: { follower_count: 1 } },
          { session }
        )

        if (useOutbox) {
          await this.outboxPublisher.publish(
            {
              event_id: randomUUID(),
              type: DomainEventType.UserFollowed,
              aggregate_type: DomainAggregateType.FollowerRelation,
              aggregate_id: follower._id,
              actor_id: followerId,
              occurred_at: follower.created_at,
              payload: {
                relation_id: follower._id,
                follower_id: followerId,
                followed_user_id: followedUserId,
                source_type: 'FOLLOWER',
                source_id: follower._id.toHexString()
              }
            },
            { session }
          )
        }
      })
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw new HttpError(MESSAGES.USER_ALREADY_FOLLOWED, HTTP_STATUS.CONFLICT)
      }
      throw error
    } finally {
      await session.endSession()
    }
  }

  unfollowUser = async (follow_user_id: string, followed_user_id: string) => {
    const followerId = new ObjectId(follow_user_id)
    const followedUserId = new ObjectId(followed_user_id)
    const session = this.databaseService.startSession()
    try {
      await session.withTransaction(async () => {
        const followedUser = await this.databaseService.users.findOne(
          { _id: followedUserId },
          { projection: { _id: 1 }, session }
        )
        if (!followedUser) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

        const result = await this.databaseService.followers.deleteOne(
          { follow_user_id: followerId, followed_user_id: followedUserId },
          { session }
        )
        if (result.deletedCount === 0) {
          throw new HttpError(MESSAGES.FOLLOW_RELATION_NOT_FOUND, HTTP_STATUS.BAD_REQUEST)
        }

        await this.databaseService.users.updateOne({ _id: followerId }, { $inc: { following_count: -1 } }, { session })
        await this.databaseService.users.updateOne(
          { _id: followedUserId },
          { $inc: { follower_count: -1 } },
          { session }
        )
      })
    } finally {
      await session.endSession()
    }
  }

  updateFollowNotificationPreference = async (followUserId: string, followedUserId: string, posts: boolean) => {
    const updatedAt = new Date()
    const result = await this.databaseService.followers.findOneAndUpdate(
      {
        follow_user_id: new ObjectId(followUserId),
        followed_user_id: new ObjectId(followedUserId)
      },
      {
        $set: {
          post_notifications_enabled: posts,
          updated_at: updatedAt
        }
      },
      { returnDocument: 'after' }
    )
    if (!result) {
      throw new HttpError(
        MESSAGES.FOLLOW_RELATION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        undefined,
        'FOLLOW_RELATION_NOT_FOUND'
      )
    }
    return { followed_user_id: followedUserId, posts: result.post_notifications_enabled }
  }

  getFollowNotificationPreference = async (followUserId: string, followedUserId: string) => {
    const relation = await this.databaseService.followers.findOne(
      {
        follow_user_id: new ObjectId(followUserId),
        followed_user_id: new ObjectId(followedUserId)
      },
      { projection: { followed_user_id: 1, post_notifications_enabled: 1 } }
    )
    if (!relation) {
      throw new HttpError(
        MESSAGES.FOLLOW_RELATION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        undefined,
        'FOLLOW_RELATION_NOT_FOUND'
      )
    }
    return {
      followed_user_id: relation.followed_user_id.toHexString(),
      posts: relation.post_notifications_enabled ?? false
    }
  }

  private isDuplicateKeyError(error: unknown): error is { code: number } {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
  }

  // những người đang theo dõi target_user_id này
  getFollowers = async (target_user_id: string): Promise<UserPublicDTO[]> => {
    const followers = await this.databaseService.followers
      .find({ followed_user_id: new ObjectId(target_user_id) })
      .toArray()

    if (!followers || followers.length === 0) {
      return []
    }

    const userIds = followers.map((follower) => follower.follow_user_id)
    const users = await this.databaseService.users
      .find(
        {
          _id: { $in: userIds }
        },
        {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            refresh_token: 0,
            verify: 0,
            created_at: 0,
            updated_at: 0
          }
        }
      )
      .toArray()

    return users
  }

  // những người mà user_id này đang theo dõi
  getFollowing = async (target_user_id: string): Promise<UserPublicDTO[]> => {
    const following = await this.databaseService.followers
      .find({ follow_user_id: new ObjectId(target_user_id) })
      .toArray()

    if (!following || following.length === 0) {
      return []
    }

    const userIds = following.map((f) => f.followed_user_id)
    const users = await this.databaseService.users
      .find(
        {
          _id: { $in: userIds }
        },
        {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            refresh_token: 0,
            verify: 0,
            created_at: 0,
            updated_at: 0
          }
        }
      )
      .toArray()
    return users
  }

  getSuggestedUsers = async (user_id: string): Promise<UserPublicDTO[]> => {
    const following = await this.databaseService.followers.find({ follow_user_id: new ObjectId(user_id) }).toArray()
    const followingUserIds = following.map((f) => f.followed_user_id)
    followingUserIds.push(new ObjectId(user_id))

    const suggestedUsers = await this.databaseService.users
      .find(
        { _id: { $nin: followingUserIds } },
        {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            refresh_token: 0,
            verify: 0,
            created_at: 0,
            updated_at: 0
          },
          limit: 5
        }
      )
      .toArray()

    return suggestedUsers
  }

  getFriends = async (user_id: string): Promise<UserPublicDTO[]> => {
    const following = await this.databaseService.followers.find({ follow_user_id: new ObjectId(user_id) }).toArray()
    const followingIds = following.map((f) => f.followed_user_id)

    const followers = await this.databaseService.followers.find({ followed_user_id: new ObjectId(user_id) }).toArray()
    const followerIds = followers.map((f) => f.follow_user_id.toString())

    const mutualIds = followingIds.filter((id) => followerIds.includes(id.toString()))

    if (mutualIds.length === 0) return []

    const users = await this.databaseService.users
      .find(
        { _id: { $in: mutualIds } },
        {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            refresh_token: 0,
            verify: 0,
            created_at: 0,
            updated_at: 0
          }
        }
      )
      .toArray()
    return users
  }

  getMentionCandidates = async (userId: string, q: string, tweetId: string | undefined, limit: number) => {
    return this.mentionCandidateService.getCandidates(new ObjectId(userId), {
      q,
      contextTweetId: tweetId ? new ObjectId(tweetId) : undefined,
      limit
    })
  }

  private async aggregateTweets(matchStage: any, current_user_id: string | undefined, limit: number) {
    const finalMatchStage = {
      ...matchStage,
      $or: [
        { audience: 0 },
        { $and: [{ audience: 1 }, { user_id: current_user_id ? new ObjectId(current_user_id) : null }] }
      ]
    }

    const pipeline: any[] = [
      { $match: finalMatchStage },
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(current_user_id)] }]
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
                    $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(current_user_id)] }]
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

  getUserTweets = async (username: string, cursor: string | undefined, limit: number, current_user_id?: string) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      type: { $in: [TweetType.Tweet, TweetType.Retweet, TweetType.QuoteTweet] }
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    return this.aggregateTweets(matchStage, current_user_id, limit)
  }

  getUserReplies = async (username: string, cursor: string | undefined, limit: number, current_user_id?: string) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      type: TweetType.Comment
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    return this.aggregateTweets(matchStage, current_user_id, limit)
  }

  getUserLikes = async (username: string, cursor: string | undefined, limit: number, current_user_id?: string) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = { user_id: user._id }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    const likes = await this.databaseService.likes
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
        { $replaceRoot: { newRoot: { $mergeObjects: ['$tweet', { likeId: '$_id' }] } } }
      ])
      .toArray()

    const tweetIds = likes.map((l) => l._id)

    // Then use aggregateTweets with these specific tweet IDs
    const aggregated = await this.aggregateTweets({ _id: { $in: tweetIds } }, current_user_id, limit)

    // Sort them back to the original order of likes
    const tweets = likes
      .map((like) => {
        const aggTweet = aggregated.tweets.find((t) => t._id.toString() === like._id.toString())
        return { ...aggTweet, likeId: like.likeId }
      })
      .filter((tweet) => 'author' in tweet && Boolean(tweet.author)) // Filter out deleted tweets potentially

    const has_next_page = likes.length === limit
    const next_cursor = has_next_page ? likes[likes.length - 1].likeId?.toString() : null

    return {
      tweets: tweets.map((tweet) => {
        const { likeId, ...rest } = tweet
        return rest
      }),
      next_cursor,
      has_next_page
    }
  }

  getUserMedia = async (username: string, cursor: string | undefined, limit: number, current_user_id?: string) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      medias: { $exists: true, $not: { $size: 0 } }
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    return this.aggregateTweets(matchStage, current_user_id, limit)
  }
}
