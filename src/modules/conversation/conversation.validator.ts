import { z } from 'zod'
import { validate } from '~/modules/user/user.validator'
import { ObjectId } from 'mongodb'

export const paginationValidator = validate(
  z.object({
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(10)
    })
  })
)

export const createGroupValidator = validate(
  z.object({
    body: z.object({
      name: z.string().min(1, 'Group name is required').max(100),
      members: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid member ID' })),
      avatar_url: z.string().url().optional()
    })
  })
)

export const conversationIdParamValidator = validate(
  z.object({
    params: z.object({
      conversation_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid ID format' })
    })
  })
)

export const reactMessageValidator = validate(
  z.object({
    params: z.object({
      message_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid message ID format' })
    }),
    body: z.object({
      emoji: z.string().min(1, 'Emoji is required')
    })
  })
)
