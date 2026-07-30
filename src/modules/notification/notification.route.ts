import { Router } from 'express'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import {
  getNotificationsController,
  getUnreadCountController,
  markAllAsReadController,
  markAsReadController
} from './notification.controller'
import { notificationIdValidator, notificationPaginationValidator } from './notification.validator'

const notificationRouter = Router()

// All notification endpoints require authentication
notificationRouter.use(accessTokenValidator, authenticateAccessToken)

notificationRouter.get('/', notificationPaginationValidator, wrapController(getNotificationsController))

notificationRouter.get('/unread-count', wrapController(getUnreadCountController))

notificationRouter.post('/read-all', wrapController(markAllAsReadController))

notificationRouter.post('/:id/read', notificationIdValidator, wrapController(markAsReadController))

export default notificationRouter
