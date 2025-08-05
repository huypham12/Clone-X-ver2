import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '~/utils/jwt'
import { HttpError } from '~/common/http-error'
import { MESSAGES } from '~/constants/messages'
import { TokenExpiredError } from 'jsonwebtoken'
import DatabaseService from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { envConfig } from '~/config/getEnvConfig'
import { TokenPayload } from '~/types/token-payload.type'

const databaseService = new DatabaseService()

// Middleware xác thực access token
export const authenticateAccessToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authorization = req.headers.authorization
    if (!authorization) {
      return next(new HttpError(MESSAGES.ACCESS_TOKEN_IS_REQUIRED, 401))
    }

    const [bearer, token] = authorization.split(' ')
    if (!token || bearer !== 'Bearer') {
      return next(new HttpError(MESSAGES.INVALID_TOKEN_FORMAT, HTTP_STATUS.UNAUTHORIZED))
    }

    const decodedToken = await verifyToken({
      token,
      secretKey: envConfig.secrets.jwt.access as string
    })

    // Gắn decoded token vào request
    req.decoded_authorization = decodedToken as TokenPayload
    next()
  } catch (error) {
    const message = error instanceof TokenExpiredError ? MESSAGES.TOKEN_EXPIRED : MESSAGES.UNAUTHORIZED
    return next(new HttpError(message, 401))
  }
}

// Middleware xác thực email verify token
export const authenticateEmailVerifyToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query
    if (typeof token !== 'string') {
      return next(new HttpError(MESSAGES.TOKEN_INVALID_FORMAT, 400))
    }

    const decodedToken = await verifyToken({
      token,
      secretKey: process.env.JWT_SECRET_EMAIL_VERIFY_TOKEN as string
    })

    // Gắn decoded token vào request object thông qua global property
    req.decoded_email_verify_token = decodedToken as TokenPayload
    next()
  } catch (error) {
    return next(new HttpError(MESSAGES.UNAUTHORIZED, 401))
  }
}

// Middleware xác thực refresh token
export const authenticateRefreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body
    if (!refresh_token) {
      return next(new HttpError(MESSAGES.REFRESH_TOKEN_IS_REQUIRED, 401))
    }

    const refreshTokenDoc = await databaseService.refreshTokens.findOne({
      token: refresh_token
    })
    if (!refreshTokenDoc) {
      return next(new HttpError(MESSAGES.REFRESH_TOKEN_INVALID_OR_REVOKED, HTTP_STATUS.UNAUTHORIZED))
    }

    const decodedToken = await verifyToken({
      token: refresh_token,
      secretKey: process.env.JWT_SECRET_REFRESH_TOKEN as string
    })

    req.decoded_refresh_token = decodedToken as TokenPayload
    next()
  } catch (error) {
    const message = error instanceof TokenExpiredError ? MESSAGES.TOKEN_EXPIRED : MESSAGES.UNAUTHORIZED
    return next(new HttpError(message, 401))
  }
}
