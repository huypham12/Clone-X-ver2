import { z } from 'zod'
import { validate } from '~/modules/user/user.validator'
import { ObjectId } from 'mongodb'

export const paginationValidator = validate(
  z.object({
    query: z.object({
      cursor: z.string().optional(),
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
})
  })
)

export const updateGroupValidator = validate(
  z.object({
    params: z.object({
      conversation_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid ID format' })
    }),
    body: z.object({
      name: z.string().max(100).optional(),
      avatar_url: z.string().url().optional()
    })
  })
)

export const addMembersValidator = validate(
  z.object({
    params: z.object({
      conversation_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid ID format' })
    }),
    body: z.object({
      members: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid member ID' })).min(1, 'At least one member is required')
    })
  })
)

export const messageIdParamValidator = validate(
  z.object({
    params: z.object({
      message_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid message ID format' })
    })
  })
)

export const editMessageValidator = validate(
  z.object({
    params: z.object({
      message_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid message ID format' })
    }),
    body: z.object({
      content: z.string().min(1, 'Content is required')
    })
  })
)

export const forwardMessageValidator = validate(
  z.object({
    params: z.object({
      message_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid message ID format' })
    }),
    body: z.object({
      conversation_ids: z.array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid conversation ID' })).min(1, 'At least one conversation is required')
    })
  })
)
