import { AuthService } from './services/auth.service'
import {
  LoginBodyDto,
  LoginResponseDto,
  RegisterBodyDto,
  RegisterResponseDto,
  ChangePasswordResponseDto,
  ChangePasswordBodyDto
} from './dto'
import { PatchHandler, PostHandler } from '~/types/controller-handler.type'
import { LogoutBodyDto, LogoutResponseDto } from './dto/logout.dto'
import { RefreshTokenBodyDto, RefreshTokenResponseDto } from './dto/refresh-token.dto'
import { TokenPayload } from '~/types/token-payload.type'
import { MESSAGES } from '~/constants/messages'
import { HTTP_STATUS } from '~/constants/httpStatus'

export class AuthController {
  constructor(private readonly authService: AuthService) {}
  /* tương đương với

    constructor(authService: AuthService) {
    this.authService = authService;
  }
  */

  // dùng đúng loại handler cho từng method, ở đây register là post nên dùng PostHandler
  register: PostHandler<RegisterBodyDto, RegisterResponseDto> = async (req, res) => {
    await this.authService.checkEmailExists(req.body.email)
    const registerResponseData = await this.authService.register(req.body)
    const response = new RegisterResponseDto(HTTP_STATUS.CREATED, MESSAGES.REGISTER_SUCCESS, registerResponseData)
    res.status(response.statusCode).json(response)
  }

  login: PostHandler<LoginBodyDto, LoginResponseDto> = async (req, res) => {
    const { email, password } = req.body
    const result = await this.authService.login({ email, password })
    res.status(result.statusCode).json(result)
  }

  logout: PostHandler<LogoutBodyDto, LogoutResponseDto> = async (req, res) => {
    const { refresh_token } = req.body
    const result = await this.authService.logout(refresh_token)
    res.json(result)
  }

  refreshToken: PostHandler<RefreshTokenBodyDto, RefreshTokenResponseDto> = async (req, res) => {
    const { refresh_token } = req.body
    const { user_id, verify, exp } = req.decoded_refresh_token as TokenPayload

    if (!user_id || !verify || !exp) return
    const result = await this.authService.refreshToken({
      refresh_token,
      user_id,
      verify,
      exp
    })
    res.json(result)
  }

  changePassword: PatchHandler<ChangePasswordBodyDto, ChangePasswordResponseDto> = async (req, res) => {
    const { old_password, new_password } = req.body
    const { user_id } = req.decoded_authorization as TokenPayload
    const result = await this.authService.changePassword({
      old_password,
      new_password,
      user_id
    })
    res.json(result)
  }
}
