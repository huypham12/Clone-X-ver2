import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './services/auth.service'
import { wrapController } from '~/utils/wrap-controller'
import {
  accessTokenValidator,
  changePasswordValidator,
  loginValidator,
  refreshTokenValidator,
  registerValidator,
  verifyEmailValidator
} from './auth.validator'
import { EmailService } from './services/email.service'
import {
  authenticateAccessToken,
  authenticateEmailVerifyToken,
  authenticateForgotPasswordToken,
  authenticateRefreshToken,
  verifiedUserValidator
} from '../../middleware/verify.middleware'

const authRouter = Router()
const databaseService = new DatabaseService() // vì export bằng class nên phải khởi tạo
const emailService = new EmailService()
const authService = new AuthService(databaseService, emailService)
const authController = new AuthController(authService, emailService)

authRouter.post('/register', registerValidator, wrapController(authController.register))

authRouter.post('/login', loginValidator, wrapController(authController.login))

authRouter.post(
  '/logout',
  accessTokenValidator,
  refreshTokenValidator,
  authenticateAccessToken,
  wrapController(authController.logout)
)

authRouter.post(
  '/refresh-token',
  refreshTokenValidator,
  authenticateRefreshToken,
  wrapController(authController.refreshToken)
)

authRouter.post('/resend-verify-email', wrapController(authController.resendVerifyEmail))

// sau khi click link thì fronend sẽ gửi token trong body tới /api/auth/verify-email
authRouter.post(
  '/verify-email',
  verifyEmailValidator,
  authenticateEmailVerifyToken,
  wrapController(authController.verifyEmail)
)

authRouter.post('/forgot-password', wrapController(authController.forgotPassword))
// khi người dùng click vào link, link đó là của frontend, sau đó frontend sẽ gọi đến api này để xác thực token (truyền token trong body)
authRouter.post(
  '/verify-forgot-password',
  authenticateForgotPasswordToken,
  wrapController(authController.verifyForgotPasswordToken)
)
// khi xác thực thành công thì sẽ tạo form cho người dùng nhập mật khẩu và gọi đến api reset-password để đổi mật khẩu mới
authRouter.post('/reset-password', authenticateForgotPasswordToken, wrapController(authController.resetPassword))

authRouter.patch(
  '/change-password',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  changePasswordValidator,
  wrapController(authController.changePassword)
)

export default authRouter
