import { AuthService } from './services/auth.service'
import {
  ResendVerifyEmailBodyDto,
  ResendVerifyEmailResponseDto,
  LoginBodyDto,
  LoginResponseDto,
  RegisterBodyDto,
  RegisterResponseDto,
  VerifyEmailResponseDto
} from './dto'
import { PostHandler, GetHandler } from '~/types/controller-handler.type'
import { LogoutBodyDto, LogoutResponseDto } from './dto/logout.dto'
import { RefreshTokenBodyDto, RefreshTokenResponseDto } from './dto/refresh-token.dto'
import { EmailService } from './services/email.service'
import { getVerifyEmailTemplate } from '~/utils/email-templete'
import { TokenPayload } from '~/types/token-payload.type'

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService
  ) {}
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
    const { email, password } = req.body
    const result = await this.authService.login({ email, password })
    res.status(result.statusCode).json(result)
  }

  logout: PostHandler<LogoutBodyDto, LogoutResponseDto> = async (req, res) => {
    const { refresh_token } = req.body
    console.log('hi')
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

  resendVerifyEmail: PostHandler<ResendVerifyEmailBodyDto, ResendVerifyEmailResponseDto> = async (req, res) => {
    const { email } = req.body
    const token = await this.authService.resendVerifyEmail(email)
    // gửi link kèm email verify token để khi người dùng click vào link đó thì gọi đến api /verify-email
    const result = await this.emailService.sendEmail({
      to: email,
      subject: 'Xác minh địa chỉ email của bạn',
      text: `Chào bạn, vui lòng xác minh địa chỉ email của bạn bằng cách nhấn vào liên kết sau: http://localhost:3000/verify-email?token=${token}`,
      html: getVerifyEmailTemplate(token)
    })
    res.json(result)
  }

  verifyEmail: GetHandler<VerifyEmailResponseDto> = async (req, res) => {
    const { token } = req.query
    const { user_id, verify } = req.decoded_email_verify_token as TokenPayload
    const result = await this.authService.verifyEmail({
      token,
      user_id,
      verify
    })

    res.json(result)
  }
}
