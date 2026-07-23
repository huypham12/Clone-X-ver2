import { Router } from 'express'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import { 
  getConversationsController,
  getDirectConversationController,
  createGroupConversationController,
  deleteConversationController,
  getMessagesController,
  markReadController,
  revokeMessageController,
  deleteMessageController,
  reactMessageController,
  pinConversationController,
  unpinConversationController,
  searchMessagesController,
  getConversationMediaController,
  muteConversationController,
  unmuteConversationController
} from './conversation.controller'
import { 
  paginationValidator, 
  createGroupValidator, 
  conversationIdParamValidator, 
  reactMessageValidator 
} from './conversation.validator'
import { searchQueryValidator } from '../search/search.validator'

const conversationRouter = Router()

// Áp dụng middleware auth cho tất cả route chat
conversationRouter.use(accessTokenValidator, authenticateAccessToken)

// 1. Quản lý Hội thoại
conversationRouter.get(
  '/', 
  wrapController(getConversationsController)
)

conversationRouter.post(
  '/direct/:receiver_id',
  // tái sử dụng objectId param validation cho receiver_id
  wrapController(getDirectConversationController)
)

conversationRouter.post(
  '/group',
  createGroupValidator,
  wrapController(createGroupConversationController)
)

conversationRouter.delete(
  '/:conversation_id',
  conversationIdParamValidator,
  wrapController(deleteConversationController)
)

conversationRouter.post(
  '/:conversation_id/pin',
  conversationIdParamValidator,
  wrapController(pinConversationController)
)

conversationRouter.delete(
  '/:conversation_id/pin',
  conversationIdParamValidator,
  wrapController(unpinConversationController)
)

// 2. Quản lý Tin nhắn trong một hội thoại
conversationRouter.get(
  '/:conversation_id/messages',
  conversationIdParamValidator,
  paginationValidator,
  wrapController(getMessagesController)
)

conversationRouter.get(
  '/:conversation_id/search',
  conversationIdParamValidator,
  searchQueryValidator,
  wrapController(searchMessagesController)
)

conversationRouter.get(
  '/:conversation_id/media',
  conversationIdParamValidator,
  paginationValidator,
  wrapController(getConversationMediaController)
)

conversationRouter.post(
  '/:conversation_id/read',
  wrapController(markReadController)
)

// 3. Thao tác với từng tin nhắn cụ thể
conversationRouter.post(
  '/messages/:message_id/revoke',
  wrapController(revokeMessageController)
)

conversationRouter.delete(
  '/messages/:message_id',
  wrapController(deleteMessageController)
)

conversationRouter.post(
  '/messages/:message_id/react',
  reactMessageValidator,
  wrapController(reactMessageController)
)

conversationRouter.post(
  '/:conversation_id/mute',
  conversationIdParamValidator,
  wrapController(muteConversationController)
)

conversationRouter.delete(
  '/:conversation_id/mute',
  conversationIdParamValidator,
  wrapController(unmuteConversationController)
)

export default conversationRouter
