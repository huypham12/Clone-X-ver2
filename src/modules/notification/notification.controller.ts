import { Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import notificationService from './notification.service'
import { GetHandler, PostHandler } from '~/types/controller-handler.type'
import { GetNotificationsResponseDto, NotificationResponseDto } from './dto'
import { PaginationQueryDto } from '../conversation/dto'

export const getNotificationsController: GetHandler<GetNotificationsResponseDto, any, PaginationQueryDto> = async (
  req,
  res
) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { page, limit } = req.query as any

  const result = await notificationService.getNotifications(user_id, Number(page), Number(limit))

  const response = new GetNotificationsResponseDto(HTTP_STATUS.OK, 'Get notifications successfully', result)
  res.status(response.statusCode).json(response)
}

export const markAllAsReadController: PostHandler<any, NotificationResponseDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id

  const result = await notificationService.markAllAsRead(user_id)

  const response = new NotificationResponseDto(HTTP_STATUS.OK, 'Marked all as read successfully', result)
  res.status(response.statusCode).json(response)
}

export const markAsReadController: PostHandler<any, NotificationResponseDto, { id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { id } = req.params

  const result = await notificationService.markAsRead(user_id, id)

  const response = new NotificationResponseDto(HTTP_STATUS.OK, 'Marked as read successfully', result)
  res.status(response.statusCode).json(response)
}
