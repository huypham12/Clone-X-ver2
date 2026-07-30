import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { validate } from '~/modules/user/user.validator'
import { isNotificationCursor } from './notification-cursor'

const objectIdString = z.string().refine((value) => ObjectId.isValid(value), {
  message: 'Invalid notification ID format'
})

const notificationCursorString = z.string().refine(isNotificationCursor, {
  message: 'Invalid notification cursor'
})

const notificationPaginationSchema = z.object({
  query: z.object({
    cursor: notificationCursorString.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10)
  })
})

const notificationIdSchema = z.object({
  params: z.object({
    id: objectIdString
  })
})

export type NotificationPaginationQuery = z.infer<typeof notificationPaginationSchema>['query']
export type NotificationIdParams = z.infer<typeof notificationIdSchema>['params']

export const notificationPaginationValidator = validate(notificationPaginationSchema)
export const notificationIdValidator = validate(notificationIdSchema)
