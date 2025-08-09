import { Request, Response, NextFunction } from 'express'
import { z, ZodError, ZodTypeAny } from 'zod'
import { HttpError } from '~/common/http-error'
import { MESSAGES } from '~/constants/messages'
import DatabaseService from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'

const databaseService = new DatabaseService()
export const REGEX_USERNAME = /^(?![0-9]+$)[A-Za-z0-9_]{4,15}$/

// Middleware để validate dữ liệu bằng Zod
export const validate = <T extends ZodTypeAny>(schema: T) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await schema.parseAsync({
        body: req.body,
        query: req.query,
        headers: req.headers,
        params: req.params
      })

      req.validatedData = result
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {}
        error.issues.forEach((issue) => {
          const path = issue.path.join('.') || 'validation'
          if (!errors[path]) errors[path] = []
          errors[path].push(issue.message)
        })
        return next(new HttpError('Validation failed', 400, errors))
      }

      console.error('Unexpected validation error:', error)
      return next(new HttpError('Internal Server Error', 500))
    }
  }
}
const updateMeSchema = z.object({
  name: z
    .string({ message: MESSAGES.NAME_MUST_BE_STRING })
    .min(1, { message: MESSAGES.NAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .max(100, { message: MESSAGES.NAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .optional(),

  date_of_birth: z
    .string({ message: MESSAGES.DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD })
    .refine(
      (value) => {
        const iso8601Regex = /^\d{4}-\d{2}-\d{2}$/
        return iso8601Regex.test(value)
      },
      { message: MESSAGES.DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD }
    )
    .optional(),

  bio: z
    .string({ message: MESSAGES.BIO_MUST_BE_STRING })
    .min(1, { message: MESSAGES.BIO_LENGTH_MUST_BE_FROM_1_TO_1000 })
    .max(1000, { message: MESSAGES.BIO_LENGTH_MUST_BE_FROM_1_TO_1000 })
    .optional(),

  website: z
    .string({ message: MESSAGES.WEBSITE_MUST_BE_URL })
    .url({ message: MESSAGES.WEBSITE_MUST_BE_URL })
    .optional(),

  username: z
    .string({ message: MESSAGES.USERNAME_MUST_BE_STRING })
    .min(1, { message: MESSAGES.USERNAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .max(100, { message: MESSAGES.USERNAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .refine((value) => {
      if (REGEX_USERNAME && !REGEX_USERNAME.test(value)) {
        throw new HttpError(MESSAGES.USERNAME_MUST_BE_ALPHANUMERIC, HTTP_STATUS.BAD_REQUEST)
      }
      return true
    })
    .refine(
      async (value) => {
        const existing = await databaseService.users.findOne({ username: value })
        return !existing
      },
      { message: MESSAGES.USERNAME_ALREADY_EXISTS }
    )
    .optional(),

  avatar: z.string({ message: MESSAGES.AVATAR_MUST_BE_URL }).url({ message: MESSAGES.AVATAR_MUST_BE_URL }).optional(),

  cover_photo: z
    .string({ message: MESSAGES.COVER_PHOTO_MUST_BE_URL })
    .url({ message: MESSAGES.COVER_PHOTO_MUST_BE_URL })
    .optional(),

  location: z
    .string({ message: MESSAGES.LOCATION_MUST_BE_STRING })
    .min(1, { message: MESSAGES.LOCATION_LENGTH_MUST_BE_FROM_1_TO_100 })
    .max(100, { message: MESSAGES.LOCATION_LENGTH_MUST_BE_FROM_1_TO_100 })
    .optional()
})

export const updateMeValidator = validate(z.object({ body: updateMeSchema }))
