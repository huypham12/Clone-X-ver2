import { Router } from 'express'
import { databaseService } from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './services/auth.service'
import { wrapController } from '~/utils/wrap-controller'
import {
  accessTokenValidator,
  changePasswordValidator,
  loginValidator,
  refreshTokenValidator,
  registerValidator
} from './auth.validator'
import {
  authenticateAccessToken,
  authenticateRefreshToken,
  verifiedUserValidator
} from '../../middleware/verify.middleware'

const authRouter = Router()
const authService = new AuthService(databaseService)
const authController = new AuthController(authService)

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

authRouter.patch(
  '/change-password',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  changePasswordValidator,
  wrapController(authController.changePassword)
)

export default authRouter
