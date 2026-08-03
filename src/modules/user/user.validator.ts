import { z } from 'zod'
import { MESSAGES } from '~/constants/messages'
import { databaseService } from '~/config/database.service'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { ObjectId } from 'mongodb'
import { validate } from '~/utils/validate'

export const REGEX_USERNAME = /^(?![0-9]+$)[A-Za-z0-9_]{4,15}$/

const updateMeSchema = z.object({
  name: z
    .string({ message: MESSAGES.NAME_MUST_BE_STRING })
    .min(1, { message: MESSAGES.NAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .max(100, { message: MESSAGES.NAME_LENGTH_MUST_BE_FROM_1_TO_100 })
    .optional(),

  date_of_birth: z
    .string({ message: MESSAGES.DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD })
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), { message: MESSAGES.DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD })
    .optional(),

  bio: z
    .string({ message: MESSAGES.BIO_MUST_BE_STRING })
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
    .optional(),

  avatar: z
    .string({ message: MESSAGES.AVATAR_MUST_BE_URL })
    .url({ message: MESSAGES.AVATAR_MUST_BE_URL })
    .or(z.literal(''))
    .optional(),

  cover_photo: z
    .string({ message: MESSAGES.COVER_PHOTO_MUST_BE_URL })
    .url({ message: MESSAGES.COVER_PHOTO_MUST_BE_URL })
    .or(z.literal(''))
    .optional(),

  location: z
    .string({ message: MESSAGES.LOCATION_MUST_BE_STRING })
    .min(1, { message: MESSAGES.LOCATION_LENGTH_MUST_BE_FROM_1_TO_100 })
    .max(100, { message: MESSAGES.LOCATION_LENGTH_MUST_BE_FROM_1_TO_100 })
    .optional()
})

export const updateMeValidator = validate(z.object({ body: updateMeSchema }))

export const followedUserIdValidator = validate(
  z.object({
    params: z.object({
      followed_user_id: z.string().refine((value) => ObjectId.isValid(value), {
        message: 'Invalid followed_user_id'
      })
    })
  })
)

export const followNotificationPreferenceValidator = validate(
  z.object({
    params: z.object({
      followed_user_id: z.string().refine((value) => ObjectId.isValid(value), {
        message: 'Invalid followed_user_id'
      })
    }),
    body: z.object({ posts: z.boolean() }).strict()
  })
)
