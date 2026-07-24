import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import { UserPrivateDTO, UserPublicDTO } from './dto/user.dto'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { Follower, User, UserBlock } from '~/schemas'
import { NotificationType, TweetType } from '~/constants/enums'
import notificationService from '../notification/notification.service'

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

  getUserInfoByUsername = async (username: string): Promise<UserPublicDTO> => {
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
    return user
  }

  // partial biến tất cả thuộc tính thành optional
  updateMeInfo = async (user_id: string, updateData: any): Promise<UserPrivateDTO> => {
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

  getUserTweets = async (username: string, cursor: string | undefined, limit: number) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      type: { $in: [TweetType.Tweet, TweetType.Retweet, TweetType.QuoteTweet] }
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
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

  getUserReplies = async (username: string, cursor: string | undefined, limit: number) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      type: TweetType.Comment
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    const replies = await this.databaseService.tweets
      .find(matchStage)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = replies.length === limit
    const next_cursor = has_next_page ? replies[replies.length - 1]._id.toString() : null

    return { replies, next_cursor, has_next_page }
  }

  getUserLikes = async (username: string, cursor: string | undefined, limit: number) => {
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

    const has_next_page = likes.length === limit
    const next_cursor = has_next_page ? likes[likes.length - 1].likeId?.toString() : null

    const tweets = likes.map(l => {
      const { likeId, ...rest } = l
      return rest
    })

    return { tweets, next_cursor, has_next_page }
  }

  getUserMedia = async (username: string, cursor: string | undefined, limit: number) => {
    const user = await this.databaseService.users.findOne({ username })
    if (!user) throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)

    const matchStage: any = {
      user_id: user._id,
      media_ids: { $exists: true, $not: { $size: 0 } }
    }
    if (cursor) {
      matchStage._id = { $lt: new ObjectId(cursor) }
    }

    const media = await this.databaseService.tweets
      .find(matchStage)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray()

    const has_next_page = media.length === limit
    const next_cursor = has_next_page ? media[media.length - 1]._id.toString() : null

    return { media, next_cursor, has_next_page }
  }
}
