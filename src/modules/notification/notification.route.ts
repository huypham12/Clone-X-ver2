import { Router } from 'express'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import {
  getNotificationsController,
  markAllAsReadController,
  markAsReadController
} from './notification.controller'
import { paginationValidator } from '../conversation/conversation.validator'

const notificationRouter = Router()

// All notification endpoints require authentication
notificationRouter.use(accessTokenValidator, authenticateAccessToken)

notificationRouter.get(
  '/',
  paginationValidator,
  wrapController(getNotificationsController)
)

notificationRouter.post(
  '/read-all',
  wrapController(markAllAsReadController)
)

notificationRouter.post(
  '/:id/read',
  wrapController(markAsReadController) // Need a param validator for id if we want to be strict, but keeping it simple for now
)

export default notificationRouter
