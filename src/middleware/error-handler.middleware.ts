import { ErrorRequestHandler } from 'express'
import { HttpError } from '~/common/http-error'
import { ErrorResponseDto } from '~/common/error-response.dto'

// trình xử lý lỗi chung, mọi error sẽ đều được next tới đây
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const status = err instanceof HttpError ? err.statusCode : 500
  const message = err.message || 'Internal Server Error'
  const errors = err instanceof HttpError ? err.errors || {} : {}

  const response = new ErrorResponseDto(status, message, errors)

  res.status(status).json(response)
}
