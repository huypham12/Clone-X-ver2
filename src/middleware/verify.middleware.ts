import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '~/utils/jwt'
import { HttpError } from '~/common/http-error'
import { MESSAGES } from '~/constants/messages'
import { TokenExpiredError } from 'jsonwebtoken'
import { databaseService } from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { envConfig } from '~/config/getEnvConfig'
import { TokenPayload } from '~/types/token-payload.type'
import { UserVerifyStatus } from '~/constants/enums'

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

// Middleware xác thực access token nhưng không bắt buộc (dành cho các endpoint cho cả khách và user)
export const isUserLoggedInValidator = (middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      return middleware(req, res, next)
    }
    next()
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
      secretKey: envConfig.secrets.jwt.refresh
    })

    req.decoded_refresh_token = decodedToken as TokenPayload
    next()
  } catch (error) {
    const message = error instanceof TokenExpiredError ? MESSAGES.TOKEN_EXPIRED : MESSAGES.UNAUTHORIZED
    return next(new HttpError(message, 401))
  }
}

export const verifiedUserValidator = (req: Request, res: Response, next: NextFunction) => {
  const { verify } = req.decoded_authorization as TokenPayload
  if (verify !== UserVerifyStatus.Verified) {
    next(
      new HttpError(MESSAGES.USER_NOT_VERIFIED, HTTP_STATUS.FORBIDDEN, {
        verify: [MESSAGES.USER_NOT_VERIFIED]
      })
    )
    return
  }
  next()
}
