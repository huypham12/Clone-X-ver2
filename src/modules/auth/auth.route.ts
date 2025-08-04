import { Router } from 'express'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import DatabaseService from '~/config/database.service'

const authRouter = Router()
const databaseService = new DatabaseService() // vì export bằng class nên phải khởi tạo
const authService = new AuthService(databaseService)
const authController = new AuthController(authService)

authRouter.post('/register', authController.register)

export default authRouter
