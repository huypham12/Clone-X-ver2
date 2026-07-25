import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { validate } from '~/modules/user/user.validator'
import { TweetAudience, TweetType } from '~/constants/enums'
import { ObjectId } from 'mongodb'

const createTweetSchema = z.object({
  type: z.nativeEnum(TweetType),
  audience: z.nativeEnum(TweetAudience),
  content: z.string().max(1000, { message: 'Tweet content is too long' }),
  parent_id: z.string().nullable().refine((val) => {
    if (val === null) return true
    return ObjectId.isValid(val)
  }, { message: 'Invalid parent_id' }).transform((val) => val ? new ObjectId(val) : null),
  hashtags: z.array(z.string()).default([]),
  mentions: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid mention id' })).transform((vals) => vals.map((val) => new ObjectId(val))).default([]),
  medias: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid media id' })).transform((vals) => vals.map((val) => new ObjectId(val))).default([])
}).superRefine((data, ctx) => {
  const { type, parent_id, content, hashtags, mentions, medias } = data
  if (type === TweetType.Retweet || type === TweetType.Comment || type === TweetType.QuoteTweet) {
    if (!parent_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'parent_id must be valid when type is Retweet, Comment or QuoteTweet',
        path: ['parent_id']
      })
    }
  }

  if (type === TweetType.Retweet && (content || hashtags.length || mentions.length || medias.length)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Retweet cannot have content, hashtags, mentions or medias',
      path: ['type']
    })
  }

  if (type !== TweetType.Retweet && !content && !hashtags.length && !mentions.length && !medias.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tweet must have at least one of content, hashtags, mentions or medias',
      path: ['type']
    })
  }
})

export const createTweetValidator = validate(
  z.object({
    body: createTweetSchema
  })
)

export const paginationValidator = validate(
  z.object({
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().min(1, 'Limit must be greater than or equal to 1').max(100).default(10)
    })
  })
)

export const tweetIdValidator = validate(
  z.object({
    params: z.object({
      tweet_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid tweet_id' })
    })
  })
)

const updateTweetSchema = z.object({
  audience: z.nativeEnum(TweetAudience).optional(),
  content: z.string().max(1000, { message: 'Tweet content is too long' }).optional(),
  hashtags: z.array(z.string()).optional(),
  mentions: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid mention id' })).transform((vals) => vals ? vals.map((val) => new ObjectId(val)) : []).optional(),
  medias: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid media id' })).transform((vals) => vals ? vals.map((val) => new ObjectId(val)) : []).optional()
})

export const updateTweetValidator = validate(
  z.object({
    params: z.object({
      tweet_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid tweet_id' })
    }),
    body: updateTweetSchema
  })
)
