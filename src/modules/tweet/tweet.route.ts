import { Router } from 'express'
import { 
  createTweetController, 
  getTweetController, 
  likeTweetController, 
  unlikeTweetController, 
  bookmarkTweetController, 
  unbookmarkTweetController,
  getTweetChildrenController,
  getNewFeedsController,
  deleteTweetController,
  getBookmarksController,
  getTweetLikesController
} from './tweet.controller'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken, isUserLoggedInValidator } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import { createTweetValidator, paginationValidator, tweetIdValidator } from './tweet.validator'

const tweetRouter = Router()

tweetRouter.get(
  '/',
  accessTokenValidator,
  authenticateAccessToken,
  paginationValidator,
  wrapController(getNewFeedsController)
)

tweetRouter.get(
  '/bookmarks',
  accessTokenValidator,
  authenticateAccessToken,
  paginationValidator,
  wrapController(getBookmarksController)
)

tweetRouter.post(
  '/',
  accessTokenValidator,
  authenticateAccessToken,
  createTweetValidator,
  wrapController(createTweetController)
)

tweetRouter.get(
  '/:tweet_id',
  isUserLoggedInValidator(accessTokenValidator),
  isUserLoggedInValidator(authenticateAccessToken),
  wrapController(getTweetController)
)

tweetRouter.get(
  '/:tweet_id/children',
  isUserLoggedInValidator(accessTokenValidator),
  isUserLoggedInValidator(authenticateAccessToken),
  paginationValidator,
  wrapController(getTweetChildrenController)
)

tweetRouter.get(
  '/:tweet_id/likes',
  paginationValidator,
  wrapController(getTweetLikesController)
)

tweetRouter.post(
  '/:tweet_id/like',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(likeTweetController)
)

tweetRouter.delete(
  '/:tweet_id/like',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(unlikeTweetController)
)

tweetRouter.post(
  '/:tweet_id/bookmark',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(bookmarkTweetController)
)

tweetRouter.delete(
  '/:tweet_id/bookmark',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(unbookmarkTweetController)
)

tweetRouter.delete(
  '/:tweet_id',
  accessTokenValidator,
  authenticateAccessToken,
  tweetIdValidator,
  wrapController(deleteTweetController)
)

export default tweetRouter
