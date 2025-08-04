import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { registerValidator } from './auth.middleware'

const authRouter = Router()
const databaseService = new DatabaseService() // vì export bằng class nên phải khởi tạo
const authService = new AuthService(databaseService)
const authController = new AuthController(authService)

authRouter.post('/register', registerValidator, authController.register)

export default authRouter
