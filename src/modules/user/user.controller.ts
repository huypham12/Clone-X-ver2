import { UserService } from './user.service'
import { GetHandler, PatchHandler, PostHandler } from '~/types/controller-handler.type'
import { TokenPayload } from '~/types/token-payload.type'
import { UserResponseDto } from './dto/user.dto'

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
}
