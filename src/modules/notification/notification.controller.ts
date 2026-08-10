import { HTTP_STATUS } from '~/constants/httpStatus'
import notificationService from './notification.service'
import { GetHandler, PostHandler } from '~/types/controller-handler.type'
import { GetNotificationResponseDto, GetNotificationsResponseDto, NotificationResponseDto } from './dto'
import { HttpError } from '~/common/http-error'
import type { ParamsDictionary } from 'express-serve-static-core'
import type { NotificationIdParams, NotificationPaginationQuery } from './notification.validator'

const getAuthenticatedUserId = (userId: string | undefined): string => {
  if (!userId) {
    throw new HttpError('Unauthorized', HTTP_STATUS.UNAUTHORIZED)
  }
  return userId
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const getValidatedPaginationQuery = (validatedData: unknown): NotificationPaginationQuery => {
  if (!isRecord(validatedData) || !isRecord(validatedData.query)) {
    throw new HttpError('Validated notification query is unavailable', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }

  const { cursor, limit } = validatedData.query
  if ((cursor !== undefined && typeof cursor !== 'string') || typeof limit !== 'number') {
    throw new HttpError('Validated notification query is invalid', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }

  return { cursor, limit }
}

const getValidatedNotificationId = (validatedData: unknown): string => {
  if (!isRecord(validatedData) || !isRecord(validatedData.params) || typeof validatedData.params.id !== 'string') {
    throw new HttpError('Validated notification ID is unavailable', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
  return validatedData.params.id
}

export const getNotificationsController: GetHandler<
  GetNotificationsResponseDto,
  ParamsDictionary,
  NotificationPaginationQuery
> = async (req, res) => {
  const user_id = getAuthenticatedUserId(req.decoded_authorization?.user_id)
  const { cursor, limit } = getValidatedPaginationQuery(req.validatedData)

  const result = await notificationService.getNotifications(user_id, cursor, limit)

  const response = new GetNotificationsResponseDto(HTTP_STATUS.OK, 'Get notifications successfully', result)
  res.status(response.statusCode).json(response)
}

export const getNotificationController: GetHandler<GetNotificationResponseDto, NotificationIdParams> = async (
  req,
  res
) => {
  const user_id = getAuthenticatedUserId(req.decoded_authorization?.user_id)
  const id = getValidatedNotificationId(req.validatedData)
  const result = await notificationService.getNotification(user_id, id)
  const response = new GetNotificationResponseDto(HTTP_STATUS.OK, 'Get notification successfully', result)
  res.status(response.statusCode).json(response)
}

export const markAllAsReadController: PostHandler<
  Record<string, never>,
  NotificationResponseDto<{ updatedCount: number; unreadCount: number; version: number }>
> = async (req, res) => {
  const user_id = getAuthenticatedUserId(req.decoded_authorization?.user_id)

  const result = await notificationService.markAllAsRead(user_id)

  const response = new NotificationResponseDto(HTTP_STATUS.OK, 'Marked all as read successfully', result)
  res.status(response.statusCode).json(response)
}

export const markAsReadController: PostHandler<
  Record<string, never>,
  NotificationResponseDto<{ success: true; unreadCount: number; version: number }>,
  NotificationIdParams
> = async (req, res) => {
  const user_id = getAuthenticatedUserId(req.decoded_authorization?.user_id)
  const id = getValidatedNotificationId(req.validatedData)

  const result = await notificationService.markAsRead(user_id, id)

  const response = new NotificationResponseDto(HTTP_STATUS.OK, 'Marked as read successfully', result)
  res.status(response.statusCode).json(response)
}

export const getUnreadCountController: GetHandler<
  NotificationResponseDto<{ unreadCount: number; version: number; updated_at: Date }>
> = async (req, res) => {
  const user_id = getAuthenticatedUserId(req.decoded_authorization?.user_id)
  const result = await notificationService.getUnreadCount(user_id)
  const response = new NotificationResponseDto(HTTP_STATUS.OK, 'Get notification unread count successfully', result)
  res.status(response.statusCode).json(response)
}
