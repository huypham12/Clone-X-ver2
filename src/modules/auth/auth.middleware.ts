import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'
import { ErrorWithStatus } from '~/models/errors'
import { authMessage, tokenMessage, userMessage } from '~/constants/messages'
import databaseService from '~/services/database.services'
import { verifyToken } from '~/utils/jwt'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { TokenExpiredError } from 'jsonwebtoken'
import { ObjectId } from 'mongodb'

// Helpers
const validateBearerToken = (value: string) => {
  if (!value)
    throw new ErrorWithStatus({ message: tokenMessage.ACCESS_TOKEN_IS_REQUIRED, status: HTTP_STATUS.UNAUTHORIZED })
  const [bearer, token] = value.split(' ')
  if (!token || bearer !== 'Bearer') {
    throw new ErrorWithStatus({
      message: 'Invalid token format. Must be: Bearer <token>',
      status: HTTP_STATUS.UNAUTHORIZED
    })
  }
  return token
}

const verifyAccessToken = async (token: string) => {
  try {
    return await verifyToken({ token, secretKey: process.env.JWT_SECRET_ACCESS_TOKEN as string })
  } catch (error: any) {
    if (error instanceof TokenExpiredError) {
      throw new ErrorWithStatus({ message: tokenMessage.TOKEN_EXPIRED, status: HTTP_STATUS.UNAUTHORIZED })
    }
    throw new ErrorWithStatus({ message: authMessage.UNAUTHORIZED, status: HTTP_STATUS.UNAUTHORIZED })
  }
}

const verifyRefreshToken = async ({ token, secretKey }: { token: string; secretKey: string }) => {
  const foundToken = await databaseService.refreshTokens.findOne({ token })
  if (!foundToken)
    throw new ErrorWithStatus({ message: tokenMessage.REFRESH_TOKEN_IS_REQUIRED, status: HTTP_STATUS.UNAUTHORIZED })

  try {
    return await verifyToken({ token, secretKey })
  } catch {
    throw new ErrorWithStatus({ message: authMessage.UNAUTHORIZED, status: HTTP_STATUS.UNAUTHORIZED })
  }
}

const emailVerifyToken = async ({ token, secretKey }: { token: string; secretKey: string }) => {
  try {
    return await verifyToken({ token, secretKey })
  } catch {
    throw new ErrorWithStatus({ message: authMessage.UNAUTHORIZED, status: HTTP_STATUS.UNAUTHORIZED })
  }
}

const verifyForgotPasswordToken = async ({ token, secretKey }: { token: string; secretKey: string }) => {
  try {
    return await verifyToken({ token, secretKey })
  } catch {
    throw new ErrorWithStatus({ message: authMessage.UNAUTHORIZED, status: HTTP_STATUS.UNAUTHORIZED })
  }
}

export const accessTokenValidator = validate(
  checkSchema(
    {
      Authorization: {
        custom: {
          options: async (value, { req }) => {
            const token = validateBearerToken(value)
            req.decoded_authorization = await verifyAccessToken(token)
            return true
          }
        }
      }
    },
    ['headers']
  )
)

export const refreshTokenValidator = validate(
  checkSchema(
    {
      refresh_token: {
        notEmpty: { errorMessage: tokenMessage.REFRESH_TOKEN_IS_REQUIRED },
        custom: {
          options: async (value, { req }) => {
            req.decoded_refresh_token = await verifyRefreshToken({
              token: value,
              secretKey: process.env.JWT_SECRET_REFRESH_TOKEN as string
            })
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const emailVerifyTokenValidator = validate(
  checkSchema(
    {
      email_verify_token: {
        notEmpty: { errorMessage: tokenMessage.EMAIL_VERIFY_TOKEN_IS_REQUIRED },
        custom: {
          options: async (value, { req }) => {
            req.decoded_email_verify_token = await emailVerifyToken({
              token: value,
              secretKey: process.env.JWT_SECRET_EMAIL_VERIFY_TOKEN as string
            })
            return true
          }
        }
      }
    },
    ['body', 'query']
  )
)

export const verifyForgotPasswordTokenValidator = validate(
  checkSchema(
    {
      forgot_password_token: {
        notEmpty: { errorMessage: tokenMessage.FORGOT_PASSWORD_TOKEN_IS_REQUIRED },
        custom: {
          options: async (value, { req }) => {
            const decoded = await verifyForgotPasswordToken({
              token: value,
              secretKey: process.env.JWT_SECRET_FORGOT_PASSWORD_TOKEN as string
            })
            const user = await databaseService.users.findOne({ _id: new ObjectId(decoded.user_id) })
            if (!user) throw new ErrorWithStatus({ message: authMessage.USER_NOT_FOUND, status: HTTP_STATUS.NOT_FOUND })
            if (user.forgot_password_token !== value) {
              throw new ErrorWithStatus({
                message: tokenMessage.INVALID_FORGOT_PASSWORD_TOKEN,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            req.decoded_forgot_password_token = decoded
            return true
          }
        }
      }
    },
    ['body']
  )
)
