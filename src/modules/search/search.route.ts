import { Router } from 'express'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import {
  searchUsersController,
  searchTweetsController,
  searchHashtagsController
} from './search.controller'
import { searchQueryValidator, searchTweetsQueryValidator } from './search.validator'

const searchRouter = Router()

// All search endpoints require authentication
searchRouter.use(accessTokenValidator, authenticateAccessToken)

searchRouter.get(
  '/users',
  searchQueryValidator,
  wrapController(searchUsersController)
)

searchRouter.get(
  '/tweets',
  searchTweetsQueryValidator,
  wrapController(searchTweetsController)
)

searchRouter.get(
  '/hashtags',
  wrapController(searchHashtagsController) // Basic query check is handled inside or by generic validator
)

export default searchRouter
