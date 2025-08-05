import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './services/auth.service'
import { wrapController } from '~/utils/wrap-controller'
import {
  accessTokenValidator,
  loginValidator,
  refreshTokenValidator,
  registerValidator,
  verifyEmailValidator
} from './auth.validator'
import { EmailService } from './services/email.service'
import { authenticateAccessToken, authenticateEmailVerifyToken, authenticateRefreshToken } from './auth.middleware'

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

authRouter.get(
  '/verify-email',
  verifyEmailValidator,
  authenticateEmailVerifyToken,
  wrapController(authController.verifyEmail)
)

export default authRouter
