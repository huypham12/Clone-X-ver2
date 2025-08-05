import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { wrapController } from '~/utils/wrap-controller'
import { accessTokenValidator, loginValidator, refreshTokenValidator, registerValidator } from './auth.validator'

const authRouter = Router()
const databaseService = new DatabaseService() // vì export bằng class nên phải khởi tạo
const authService = new AuthService(databaseService)
const authController = new AuthController(authService)

authRouter.post('/register', registerValidator, wrapController(authController.register))

authRouter.post('/login', loginValidator, wrapController(authController.login))

authRouter.post('/logout', accessTokenValidator, refreshTokenValidator, wrapController(authController.logout))

authRouter.post('/refresh-token', refreshTokenValidator, wrapController(authController.refreshToken))

export default authRouter
