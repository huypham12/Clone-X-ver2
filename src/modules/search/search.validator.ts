import { z } from 'zod'
import { validate } from '~/modules/user/user.validator'

export const searchQueryValidator = validate(
  z.object({
    query: z.object({
      q: z.string().min(1, 'Search query cannot be empty'),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(10)
    })
  })
)

export const searchTweetsQueryValidator = validate(
  z.object({
    query: z.object({
      q: z.string().min(1, 'Search query cannot be empty'),
      type: z.enum(['all', 'media']).default('all'),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(10)
    })
  })
)
