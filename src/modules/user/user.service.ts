import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import { UserPrivateDTO, UserPublicDTO } from './dto/user.dto'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { Follower, User, UserBlock } from '~/schemas'
import { NotificationType, TweetType } from '~/constants/enums'
import notificationService from '../notification/notification.service'
import { getParentTweetLookupStages, getIsRetweetedLookupStages } from '~/utils/aggregation'

export class UserService {
  constructor(private readonly databaseService: DatabaseService) {}
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
    
    if (current_user_id) {
       const [following, blocked] = await Promise.all([
          this.databaseService.followers.findOne({ follow_user_id: new ObjectId(current_user_id), followed_user_id: user._id }),
          this.databaseService.userBlocks.findOne({ user_id: new ObjectId(current_user_id), blocked_user_id: user._id })
       ])
       is_following = !!following
       is_blocked = !!blocked
    }

    return { ...user, is_following, is_blocked }
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

    // Check if already blocked
    const existingBlock = await this.databaseService.userBlocks.findOne({
      user_id: new ObjectId(user_id),
      blocked_user_id: user._id // lấy _id bên trên để tìm
    })
    if (existingBlock) {
      throw new HttpError(MESSAGES.USER_BLOCKED, HTTP_STATUS.CONFLICT)
    }

    const blockedUser = new UserBlock({
      user_id: new ObjectId(user_id),
      blocked_user_id: user._id
    })
    await this.databaseService.userBlocks.insertOne(blockedUser)
  }

  unblockUser = async (user_id: string, blocked_user_id: string) => {
    // kiểm tra xem có user này không
    const user = await this.databaseService.users.findOne({ _id: new ObjectId(blocked_user_id) })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // Kiểm tra xem đã block hay chưa
    const existingBlock = await this.databaseService.userBlocks.findOne({
      user_id: new ObjectId(user_id),
      blocked_user_id: user._id
    })
    if (!existingBlock) {
      throw new HttpError(MESSAGES.USER_NOT_BLOCKED, HTTP_STATUS.BAD_REQUEST)
    }

    await this.databaseService.userBlocks.deleteOne({
      user_id: new ObjectId(user_id),
      blocked_user_id: user._id
    })
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
    // kiểm tra xem có user này không
    const user = await this.databaseService.users.findOne({ _id: new ObjectId(followed_user_id) })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // kiểm tra xem username này có block current user và ngược lại
    const existingBlock =
      (await this.databaseService.userBlocks.findOne({
        user_id: new ObjectId(user_id),
        blocked_user_id: user._id
      })) ||
      (await this.databaseService.userBlocks.findOne({
        user_id: user._id,
        blocked_user_id: new ObjectId(user_id)
      }))
    if (existingBlock) {
      throw new HttpError(MESSAGES.FOLLOW_NOT_ALLOWED, HTTP_STATUS.FORBIDDEN)
    }

    // kiểm tra xem đã follow chưa
    const existingFollow = await this.databaseService.followers.findOne({
      follow_user_id: new ObjectId(user_id),
      followed_user_id: user._id
    })
    if (existingFollow) {
      throw new HttpError(MESSAGES.USER_ALREADY_FOLLOWED, HTTP_STATUS.CONFLICT)
    }

    const follower = new Follower({
      follow_user_id: new ObjectId(user_id),
      followed_user_id: user._id
    })
    await this.databaseService.followers.insertOne(follower)

    // Update counts
    await Promise.all([
      this.databaseService.users.updateOne(
        { _id: new ObjectId(user_id) },
        { $inc: { following_count: 1 } }
      ),
      this.databaseService.users.updateOne(
        { _id: user._id },
        { $inc: { follower_count: 1 } }
      )
    ])

    // Notification
    await notificationService.createNotification(
      followed_user_id,
      user_id,
      NotificationType.Follow
    )
  }

  unfollowUser = async (follow_user_id: string, followed_user_id: string) => {
    // Kiểm tra user bị unfollow có tồn tại không
    const followedUser = await this.databaseService.users.findOne({
      _id: new ObjectId(followed_user_id)
    })
    if (!followedUser) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // Xóa quan hệ follow
    const result = await this.databaseService.followers.deleteOne({
      follow_user_id: new ObjectId(follow_user_id),
      followed_user_id: followedUser._id
    })

    if (result.deletedCount === 0) {
      throw new HttpError(MESSAGES.FOLLOW_RELATION_NOT_FOUND, HTTP_STATUS.BAD_REQUEST)
    }

    // Update counts
    await Promise.all([
      this.databaseService.users.updateOne(
        { _id: new ObjectId(follow_user_id) },
        { $inc: { following_count: -1 } }
      ),
      this.databaseService.users.updateOne(
        { _id: followedUser._id },
        { $inc: { follower_count: -1 } }
      )
    ])
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
                    $and: [
                      { $eq: ['$tweet_id', '$$tweet_id'] },
                      { $eq: ['$user_id', new ObjectId(current_user_id)] }
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
                      { $eq: ['$user_id', new ObjectId(current_user_id)] }
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

    const tweetIds = likes.map(l => l._id)

    // Then use aggregateTweets with these specific tweet IDs
    const aggregated = await this.aggregateTweets({ _id: { $in: tweetIds } }, current_user_id, limit)
    
    // Sort them back to the original order of likes
    const tweets = likes.map(like => {
      const aggTweet = aggregated.tweets.find(t => t._id.toString() === like._id.toString())
      return { ...aggTweet, likeId: like.likeId }
    }).filter((t: any) => t.author) // Filter out deleted tweets potentially

    const has_next_page = likes.length === limit
    const next_cursor = has_next_page ? likes[likes.length - 1].likeId?.toString() : null

    return { tweets: tweets.map((t: any) => {
      const { likeId, ...rest } = t;
      return rest;
    }), next_cursor, has_next_page }
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
