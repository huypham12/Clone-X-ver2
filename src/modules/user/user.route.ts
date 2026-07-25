import { Router } from 'express'
import DatabaseService from '~/config/database.service'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken, verifiedUserValidator, isUserLoggedInValidator } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import { updateMeValidator } from './user.validator'
import { paginationValidator } from '../tweet/tweet.validator'

const userRouter = Router()
const databaseService = new DatabaseService()
const userService = new UserService(databaseService)
const userController = new UserController(userService)

userRouter.get('/me', accessTokenValidator, authenticateAccessToken, wrapController(userController.getMeController))
userRouter.get('/profile/:username', isUserLoggedInValidator(authenticateAccessToken), wrapController(userController.getProfileController))
userRouter.patch(
  '/me',
  accessTokenValidator,
  authenticateAccessToken,
  updateMeValidator,
  wrapController(userController.updateMeController)
)

userRouter.post(
  '/:blocked_user_id/block',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  wrapController(userController.blockUserController)
)

userRouter.delete(
  '/:blocked_user_id/block',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  wrapController(userController.unblockUserController)
)

userRouter.get(
  '/blocked-users',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  wrapController(userController.getBlockedUsersController)
)

userRouter.post(
  '/:followed_user_id/follow',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  wrapController(userController.followUserController)
)



userRouter.delete(
  '/:followed_user_id/follow',
  accessTokenValidator,
  authenticateAccessToken,
  verifiedUserValidator,
  wrapController(userController.unfollowUserController)
)

userRouter.get(
  '/:target_user_id/followers',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(userController.getFollowersController)
)

userRouter.get(
  '/:target_user_id/following',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(userController.getFollowingController)
)

userRouter.get(
  '/:username/tweets',
  paginationValidator,
  wrapController(userController.getUserTweetsController)
)

userRouter.get(
  '/:username/replies',
  paginationValidator,
  wrapController(userController.getUserRepliesController)
)

userRouter.get(
  '/:username/likes',
  paginationValidator,
  wrapController(userController.getUserLikesController)
)

userRouter.get(
  '/:username/media',
  paginationValidator,
  wrapController(userController.getUserMediaController)
)

export default userRouter
