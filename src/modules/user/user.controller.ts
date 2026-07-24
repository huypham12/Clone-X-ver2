import { UserService } from './user.service'
import { DeleteHandler, GetHandler, PatchHandler, PostHandler } from '~/types/controller-handler.type'
import { TokenPayload } from '~/types/token-payload.type'
import { UserResponseDto } from './dto/user.dto'
import { BlockUserResponseDto, UnblockUserResponseDto } from './dto/blocked_user.dto'
import { MESSAGES } from '~/constants/messages'
import { HTTP_STATUS } from '~/constants/httpStatus'

export class UserController {
  constructor(private readonly userService: UserService) {}

  getMeController: GetHandler<UserResponseDto> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getMeInfo(user_id)
    res.json(new UserResponseDto(result))
  }

  getProfileController: GetHandler<UserResponseDto> = async (req, res) => {
    const { username } = req.params
    const result = await this.userService.getUserInfoByUsername(username)
    res.json(new UserResponseDto(result))
  }

  updateMeController: PatchHandler<UserResponseDto> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.updateMeInfo(user_id, req.body)
    res.json(new UserResponseDto(result))
  }

  blockUserController: PostHandler<UnblockUserResponseDto> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { blocked_user_id } = req.params
    await this.userService.blockUser(user_id, blocked_user_id)
    res.json(new BlockUserResponseDto())
  }

  unblockUserController: DeleteHandler<UnblockUserResponseDto> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { blocked_user_id } = req.params
    await this.userService.unblockUser(user_id, blocked_user_id)
    res.json(new UnblockUserResponseDto())
  }

  getBlockedUsersController: GetHandler<{ users: UserResponseDto[] }> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getBlockedUsers(user_id)
    res.json({ users: result.map((user) => new UserResponseDto(user)) })
  }

  followUserController: PostHandler = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { followed_user_id } = req.params
    await this.userService.followUser(user_id, followed_user_id)
    res.json({
      statusCode: HTTP_STATUS.OK,
      message: MESSAGES.FOLLOW_USER_SUCCESS
    })
  }

  unfollowUserController: DeleteHandler = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { followed_user_id } = req.params
    await this.userService.unfollowUser(user_id, followed_user_id)
    res.json({
      statusCode: HTTP_STATUS.OK,
      message: MESSAGES.UNFOLLOW_USER_SUCCESS
    })
  }

  getFollowersController: GetHandler<{ followers: UserResponseDto[] }> = async (req, res) => {
    const { target_user_id } = req.params
    const result = await this.userService.getFollowers(target_user_id)
    res.json({ followers: result.map((user) => new UserResponseDto(user)) })
  }

  getFollowingController: GetHandler<{ following: UserResponseDto[] }> = async (req, res) => {
    const { target_user_id } = req.params
    const result = await this.userService.getFollowing(target_user_id)
    res.json({ following: result.map((user) => new UserResponseDto(user)) })
  }

  getUserTweetsController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    
    const result = await this.userService.getUserTweets(username, cursor, limit)
    res.json({ message: 'Get user tweets successfully', result })
  }

  getUserRepliesController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    
    const result = await this.userService.getUserReplies(username, cursor, limit)
    res.json({ message: 'Get user replies successfully', result })
  }

  getUserLikesController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    
    const result = await this.userService.getUserLikes(username, cursor, limit)
    res.json({ message: 'Get user likes successfully', result })
  }

  getUserMediaController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    
    const result = await this.userService.getUserMedia(username, cursor, limit)
    res.json({ message: 'Get user media successfully', result })
  }
}
