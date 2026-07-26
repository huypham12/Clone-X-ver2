import { UserService } from './user.service'
import { DeleteHandler, GetHandler, PatchHandler, PostHandler } from '~/types/controller-handler.type'
import { TokenPayload } from '~/types/token-payload.type'
import { UserResponseDto } from './dto/user.dto'
import { BlockUserResponseDto, UnblockUserResponseDto } from './dto/blocked_user.dto'
import { MESSAGES } from '~/constants/messages'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { SuccessResponseDto } from '~/common/success-response.dto'

export class UserController {
  constructor(private readonly userService: UserService) {}

  getMeController: GetHandler<UserResponseDto> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getMeInfo(user_id)
    res.json(new UserResponseDto(result))
  }

  getProfileController: GetHandler<UserResponseDto> = async (req, res) => {
    const { username } = req.params
    const current_user_id = req.decoded_authorization?.user_id
    const result = await this.userService.getUserInfoByUsername(username, current_user_id)
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

  getBlockedUsersController: GetHandler<any> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getBlockedUsers(user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get blocked users successfully', { users: result.map((user) => new UserResponseDto(user)) }))
  }

  followUserController: PostHandler = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { followed_user_id } = req.params
    await this.userService.followUser(user_id, followed_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, MESSAGES.FOLLOW_USER_SUCCESS, null))
  }

  unfollowUserController: DeleteHandler = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { followed_user_id } = req.params
    await this.userService.unfollowUser(user_id, followed_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, MESSAGES.UNFOLLOW_USER_SUCCESS, null))
  }

  getFollowersController: GetHandler<any> = async (req, res) => {
    const { target_user_id } = req.params
    const result = await this.userService.getFollowers(target_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get followers successfully', { followers: result }))
  }

  getFollowingController: GetHandler<any> = async (req, res) => {
    const { target_user_id } = req.params
    const result = await this.userService.getFollowing(target_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get following successfully', { following: result }))
  }

  getSuggestedUsersController: GetHandler<any> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getSuggestedUsers(user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get suggested users successfully', result))
  }

  getFriendsController: GetHandler<any> = async (req, res) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.userService.getFriends(user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get friends successfully', result))
  }

  getUserTweetsController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    const current_user_id = req.decoded_authorization?.user_id
    
    const result = await this.userService.getUserTweets(username, cursor, limit, current_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get user tweets successfully', result))
  }

  getUserRepliesController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    const current_user_id = req.decoded_authorization?.user_id
    
    const result = await this.userService.getUserReplies(username, cursor, limit, current_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get user replies successfully', result))
  }

  getUserLikesController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    const current_user_id = req.decoded_authorization?.user_id
    
    const result = await this.userService.getUserLikes(username, cursor, limit, current_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get user likes successfully', result))
  }

  getUserMediaController: GetHandler<any> = async (req, res) => {
    const { username } = req.params
    const cursor = (req.query as any).cursor as string | undefined
    const limit = Number((req.query as any).limit)
    const current_user_id = req.decoded_authorization?.user_id
    
    const result = await this.userService.getUserMedia(username, cursor, limit, current_user_id)
    res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get user media successfully', result))
  }
}
