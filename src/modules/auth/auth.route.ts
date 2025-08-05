import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { loginValidator, refreshTokenValidator, registerValidator } from './auth.validator'

const authRouter = Router()
const databaseService = new DatabaseService() // vì export bằng class nên phải khởi tạo
const authService = new AuthService(databaseService)
const authController = new AuthController(authService)

authRouter.post('/register', registerValidator, authController.register)

authRouter.post('/login', loginValidator, authController.login)

// authRouter.post('/logout', refreshTokenValidator, authController.logout)

export default authRouter
