import { AuthService } from './services/auth.service'
import {
  SendEmailBodyDto,
  SendEmailResponseDto,
  LoginBodyDto,
  LoginResponseDto,
  RegisterBodyDto,
  RegisterResponseDto,
  VerifyEmailResponseDto,
  ResetPasswordResponseDto,
  ResetPasswordBodyDto,
  VerifyEmailBodyDto,
  ChangePasswordResponseDto,
  ChangePasswordBodyDto
} from './dto'
import { PatchHandler, PostHandler } from '~/types/controller-handler.type'
import { LogoutBodyDto, LogoutResponseDto } from './dto/logout.dto'
import { RefreshTokenBodyDto, RefreshTokenResponseDto } from './dto/refresh-token.dto'
import { EmailService } from './services/email.service'
import { getForgotPasswordTemplate, getVerifyEmailTemplate } from '~/utils/email-templete'
import { TokenPayload } from '~/types/token-payload.type'
import { MESSAGES } from '~/constants/messages'

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
    await this.authService.checkEmailExists(req.body.email)
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

  resendVerifyEmail: PostHandler<SendEmailBodyDto, SendEmailResponseDto> = async (req, res) => {
    const { email } = req.body
    const token = await this.authService.resendVerifyEmail(email)
    // gửi link kèm email verify token để khi người dùng click vào link đó thì gọi đến api /verify-email
    const html = getVerifyEmailTemplate(token)
    const result = await this.emailService.sendEmail(
      {
        to: email,
        subject: 'Xác nhận địa chỉ email của bạn',
        html
      },
      MESSAGES.RESEND_VERIFY_EMAIL_SUCCESS
    )
    res.json(result)
  }

  forgotPassword: PostHandler<SendEmailBodyDto, SendEmailResponseDto> = async (req, res) => {
    const { email } = req.body
    const token = await this.authService.forgotPassword(email)
    console.log(token)
    // gửi link kèm email verify token để khi người dùng click vào link đó thì gọi đến api /verify-email
    const html = getForgotPasswordTemplate(token)
    const result = await this.emailService.sendEmail(
      {
        to: email,
        subject: 'Xác nhận địa chỉ email của bạn',
        html
      },
      MESSAGES.FORGOT_PASSWORD_SUCCESS
    )
    res.json(result)
  }

  verifyEmail: PostHandler<VerifyEmailBodyDto, VerifyEmailResponseDto> = async (req, res) => {
    const { token } = req.body
    const { user_id, verify } = req.decoded_email_verify_token as TokenPayload
    const result = await this.authService.verifyEmail({
      token,
      user_id,
      verify
    })

    res.json(result)
  }

  verifyForgotPasswordToken: PostHandler = async (req, res) => {
    res.json({
      statusCode: 200,
      message: MESSAGES.VERIFY_FORGOT_PASSWORD_TOKEN_SUCCESS
    })
  }

  resetPassword: PostHandler<ResetPasswordBodyDto, ResetPasswordResponseDto> = async (req, res) => {
    const { token, new_password } = req.body
    const result = await this.authService.resetPassword({ token, new_password })
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
