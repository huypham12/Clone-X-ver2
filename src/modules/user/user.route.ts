import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import { updateMeValidator } from './user.validator'

const userRouter = Router()
const databaseService = new DatabaseService()
const userService = new UserService(databaseService)
const userController = new UserController(userService)

userRouter.get('/me', accessTokenValidator, authenticateAccessToken, wrapController(userController.getMeController))
userRouter.get('/profile/:username', wrapController(userController.getProfileController))
userRouter.patch(
  '/me',
  accessTokenValidator,
  authenticateAccessToken,
  updateMeValidator,
  wrapController(userController.updateMeController)
)
export default userRouter
