import { AuthService } from './auth.service'
import { LoginBodyDto, LoginResponseDto, RegisterBodyDto, RegisterResponseDto } from './dto'
import { PostHandler } from '~/types/controller-handler.type'
import { LogoutBodyDto, LogoutResponseDto } from './dto/logout.dto'
import { RefreshTokenBodyDto, RefreshTokenResponseDto } from './dto/refresh-token.dto'

export class AuthController {
  constructor(private readonly authService: AuthService) {}
  /* tương đương với 

    constructor(authService: AuthService) {
    this.authService = authService;
  }
  */

  // dùng đúng loại handler cho từng method, ở đây register là post nên dùng PostHandler
  register: PostHandler<RegisterBodyDto, RegisterResponseDto> = async (req, res) => {
    const result = await this.authService.register(req.body)
    res.status(result.statusCode).json(result)
  }

  login: PostHandler<LoginBodyDto, LoginResponseDto> = async (req, res) => {
    const result = await this.authService.login(req.body)
    res.status(result.statusCode).json(result)
  }

  logout: PostHandler<LogoutBodyDto, LogoutResponseDto> = async (req, res) => {
    const { refresh_token } = req.body
    const result = await this.authService.logout(refresh_token)
    res.json(result)
  }

  refreshToken: PostHandler<RefreshTokenBodyDto, RefreshTokenResponseDto> = async (req, res) => {
    const { refresh_token } = req.body
    const result = await this.authService.refreshToken(refresh_token)
    res.json(result)
  }
}
