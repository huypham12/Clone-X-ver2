import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { wrapController } from '~/utils/wrap-controller'

const userRouter = Router()
const databaseService = new DatabaseService()
const userService = new UserService(databaseService)
const userController = new UserController(userService)

export default userRouter
