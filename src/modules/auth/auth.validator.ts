import { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'
import { HttpError } from '~/common/http-error'
import { MESSAGES } from '~/constants/messages'
import { verifyToken } from '~/utils/jwt'
import { hashPassword } from '~/utils/crypto'
import DatabaseService from '~/config/database.service'
import { ObjectId } from 'mongodb'
import { TokenExpiredError } from 'jsonwebtoken'

const databaseService = new DatabaseService()

// Schema cho password
const passwordSchema = z
  .string({
    message: MESSAGES.PASSWORD_MUST_BE_STRING
  })
  .min(1, MESSAGES.PASSWORD_IS_REQUIRED)
  .refine(
    (value) =>
      value.length >= 6 &&
      /[a-z]/.test(value) &&
      /[A-Z]/.test(value) &&
      /[0-9]/.test(value) &&
      /[^a-zA-Z0-9]/.test(value),
    { message: MESSAGES.PASSWORD_MUST_BE_STRONG }
  )

// Schema cho confirm password
export const confirmPasswordSchema = z
  .object({
    body: z.object({
      password: passwordSchema,
      confirm_password: passwordSchema
    })
  })
  .refine((data) => data.body.password === data.body.confirm_password, {
    message: MESSAGES.CONFIRM_PASSWORD_DOES_NOT_MATCH,
    path: ['body', 'confirm_password']
  })

// Schema cho forgot password token
const forgotPasswordTokenSchema = z
  .string({
    message: MESSAGES.FORGOT_PASSWORD_TOKEN_IS_REQUIRED
  })
  .min(1, MESSAGES.FORGOT_PASSWORD_TOKEN_IS_REQUIRED)
  .superRefine(async (value, ctx) => {
    try {
      const decodedToken = await verifyToken({
        token: value,
        secretKey: process.env.JWT_SECRET_FORGOT_PASSWORD_TOKEN as string
      })
      const user = await databaseService.users.findOne({ _id: new ObjectId(decodedToken.user_id) })
      if (!user) {
        ctx.addIssue({
          code: 'custom',
          message: MESSAGES.USER_NOT_FOUND,
          path: ['forgot_password_token']
        })
        return
      }
      if (value !== user.forgot_password_token) {
        ctx.addIssue({
          code: 'custom',
          message: MESSAGES.INVALID_FORGOT_PASSWORD_TOKEN,
          path: ['forgot_password_token']
        })
        return
      }
      // Gắn decoded token vào request object thông qua global property
      ;(ctx as any).decoded_forgot_password_token = decodedToken
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: MESSAGES.UNAUTHORIZED,
        path: ['forgot_password_token']
      })
    }
  })

// Middleware để validate dữ liệu bằng Zod
const validate = (schema: z.ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        headers: req.headers,
        params: req.params
      })
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {}
        error.issues.forEach((err) => {
          const path = err.path.join('.') || 'validation'
          if (!errors[path]) errors[path] = []
          errors[path].push(err.message)
        })
        return next(new HttpError('Validation failed', 400, errors))
      } else {
        console.error('Validation error:', error)
        return next(new HttpError('Internal Server Error', 500))
      }
    }
  }
}

// Register validator
export const registerValidator = validate(
  z
    .object({
      body: z.object({
        name: z
          .string({
            message: MESSAGES.NAME_MUST_BE_STRING
          })
          .min(1, MESSAGES.NAME_IS_REQUIRED)
          .max(100, MESSAGES.NAME_LENGTH_MUST_BE_FROM_1_TO_100)
          .trim(),
        email: z
          .email({
            message: MESSAGES.EMAIL_MUST_BE_VALID
          })
          .trim(),
        password: passwordSchema,
        confirm_password: passwordSchema,
        date_of_birth: z.string().refine(
          (value) => {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/
            if (!dateRegex.test(value)) return false
            const date = new Date(value)
            return !isNaN(date.getTime())
          },
          { message: MESSAGES.DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD }
        )
      })
    })
    .refine((data) => data.body.password === data.body.confirm_password, {
      message: MESSAGES.CONFIRM_PASSWORD_DOES_NOT_MATCH,
      path: ['body', 'confirm_password']
    })
)

// Login validator
export const loginValidator = validate(
  z.object({
    body: z.object({
      email: z
        .email({
          message: MESSAGES.EMAIL_MUST_BE_VALID
        })
        .trim(),
      password: z
        .string({
          message: MESSAGES.PASSWORD_MUST_BE_STRING
        })
        .min(1, MESSAGES.PASSWORD_IS_REQUIRED)
    })
  })
)

// Access token validator
export const accessTokenValidator = validate(
  z.object({
    headers: z.object({
      authorization: z
        .string({
          message: MESSAGES.ACCESS_TOKEN_IS_REQUIRED
        })
        .min(1, MESSAGES.ACCESS_TOKEN_IS_REQUIRED)
        .refine(
          (value) => {
            const [bearer, token] = value.split(' ')
            return bearer === 'Bearer' && token
          },
          { message: MESSAGES.INVALID_TOKEN_FORMAT }
        )
    })
  })
)

// Refresh token validator
export const refreshTokenValidator = validate(
  z.object({
    body: z.object({
      refresh_token: z
        .string({
          message: MESSAGES.REFRESH_TOKEN_IS_REQUIRED
        })
        .min(1, MESSAGES.REFRESH_TOKEN_IS_REQUIRED)
    })
  })
)

// Validator cho endpoint /verify-email
export const verifyEmailValidator = validate(
  z.object({
    query: z.object({
      token: z
        .string({
          message: MESSAGES.TOKEN_MUST_BE_STRING
        })
        .min(1, MESSAGES.TOKEN_IS_REQUIRED)
    })
  })
)
