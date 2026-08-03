import { z } from 'zod'
import { validate } from '~/utils/validate'
import { ObjectId } from 'mongodb'
import { isMessageReactionEmoji } from './dto'
import { envConfig } from '~/config/getEnvConfig'

const objectIdString = z.string().refine((value) => ObjectId.isValid(value), { message: 'Invalid ID format' })
const conversationType = z.enum(['direct', 'group'])
const muteDurationHours = z.union([z.literal(1), z.literal(8), z.literal(24)])

export const paginationValidator = validate(
  z.object({
    query: z.object({
      cursor: objectIdString.optional(),
      limit: z.coerce.number().min(1).max(100).default(10)
    })
  })
)

export const createGroupValidator = validate(
  z.object({
    body: z.object({
      name: z.string().min(1, 'Group name is required').max(100),
      members: z
        .array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid member ID' }))
        .max(envConfig.conversation.maxGroupMembers, 'Too many group members'),
      avatar_url: z.string().url().optional()
    })
  })
)

export const conversationIdParamValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    })
  })
)

export const clearConversationHistoryValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    })
  })
)

export const messageSearchQueryValidator = validate(
  z.object({
    query: z.object({
      q: z.string().trim().min(1, 'Search query cannot be empty'),
      cursor: objectIdString.optional(),
      limit: z.coerce.number().min(1).max(100).default(10)
    })
  })
)

export const groupConversationLookupValidator = validate(
  z.object({
    query: z.object({
      q: z.string().trim().min(1, 'Search query cannot be empty').max(100, 'Search query is too long'),
      cursor: objectIdString.optional(),
      limit: z.coerce.number().int().min(1).max(20).default(10)
    })
  })
)

export const messageContextValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString,
      message_id: objectIdString
    }),
    query: z.object({
      before: z.coerce.number().int().min(0).max(50).default(20),
      after: z.coerce.number().int().min(0).max(50).default(20)
    })
  })
)

export const muteConversationValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    }),
    body: z.object({
      type: conversationType,
      duration_hours: muteDurationHours.optional()
    })
  })
)

export const unmuteConversationValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    }),
    query: z.object({
      type: conversationType
    })
  })
)

export const reactMessageValidator = validate(
  z.object({
    params: z.object({
      message_id: objectIdString
    }),
    body: z
      .object({
        emoji: z
          .string()
          .min(1, 'Emoji is required')
          .max(64, 'Emoji is too long')
          .refine(isMessageReactionEmoji, { message: 'Reaction must be exactly one emoji' })
      })
      .strict()
  })
)

export const updateGroupValidator = validate(
  z.object({
    params: z.object({
      conversation_id: z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid ID format' })
    }),
    body: z.object({
      name: z.string().trim().min(1, 'Group name is required').max(100).optional(),
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
      members: z
        .array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid member ID' }))
        .min(1, 'At least one member is required')
        .max(envConfig.conversation.maxGroupMembers, 'Too many group members')
        .refine((members) => new Set(members).size === members.length, {
          message: 'Member IDs must be unique'
        })
    })
  })
)

export const groupMemberParamsValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString,
      user_id: objectIdString
    })
  })
)

export const transferAdminAndLeaveValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    }),
    body: z
      .object({
        successor_user_id: objectIdString
      })
      .strict()
  })
)

export const messageIdParamValidator = validate(
  z.object({
    params: z.object({
      message_id: objectIdString
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
      conversation_ids: z
        .array(z.string().refine((val) => ObjectId.isValid(val), { message: 'Invalid conversation ID' }))
        .min(1, 'At least one conversation is required'),
      client_operation_id: z.string().trim().min(1).max(128).optional()
    })
  })
)

export const markConversationReadValidator = validate(
  z.object({
    params: z.object({
      conversation_id: objectIdString
    }),
    body: z
      .object({
        message_id: objectIdString.optional()
      })
      .strict()
      .default({})
  })
)
