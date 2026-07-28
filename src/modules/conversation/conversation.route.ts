import { Router } from 'express'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'
import { 
  getConversationsController,
  searchGroupConversationsController,
  getDirectConversationController,
  createGroupConversationController,
  deleteConversationController,
  unhideConversationController,
  getMessagesController,
  getMessageContextController,
  markReadController,
  revokeMessageController,
  deleteMessageController,
  reactMessageController,
  pinConversationController,
  unpinConversationController,
  searchMessagesController,
  getConversationMediaController,
  muteConversationController,
  unmuteConversationController,
  updateGroupController,
  getGroupMembersController,
  addGroupMembersController,
  removeGroupMemberController,
  leaveGroupController,
  editMessageController,
  unreactMessageController,
  getMessageReactionsController,
  forwardMessageController
} from './conversation.controller'
import { 
  paginationValidator, 
  createGroupValidator, 
  conversationIdParamValidator, 
  reactMessageValidator,
  updateGroupValidator,
  addMembersValidator,
  messageIdParamValidator,
  editMessageValidator,
  forwardMessageValidator,
  messageSearchQueryValidator,
  muteConversationValidator,
  unmuteConversationValidator,
  messageContextValidator,
  groupConversationLookupValidator,
  groupMemberParamsValidator
} from './conversation.validator'

const conversationRouter = Router()

// Áp dụng middleware auth cho tất cả route chat
conversationRouter.use(accessTokenValidator, authenticateAccessToken)

// 1. Quản lý Hội thoại
conversationRouter.get(
  '/', 
  wrapController(getConversationsController)
)

conversationRouter.get(
  '/groups/search',
  groupConversationLookupValidator,
  wrapController(searchGroupConversationsController)
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
  '/:conversation_id/unhide',
  conversationIdParamValidator,
  wrapController(unhideConversationController)
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

conversationRouter.patch(
  '/:conversation_id',
  updateGroupValidator,
  wrapController(updateGroupController)
)

conversationRouter.get(
  '/:conversation_id/members',
  conversationIdParamValidator,
  wrapController(getGroupMembersController)
)

conversationRouter.post(
  '/:conversation_id/members',
  addMembersValidator,
  wrapController(addGroupMembersController)
)

conversationRouter.delete(
  '/:conversation_id/members/:user_id',
  groupMemberParamsValidator,
  wrapController(removeGroupMemberController)
)

conversationRouter.delete(
  '/:conversation_id/leave',
  conversationIdParamValidator,
  wrapController(leaveGroupController)
)

// 2. Quản lý Tin nhắn trong một hội thoại
conversationRouter.get(
  '/:conversation_id/messages',
  conversationIdParamValidator,
  paginationValidator,
  wrapController(getMessagesController)
)

conversationRouter.get(
  '/:conversation_id/messages/:message_id/context',
  messageContextValidator,
  wrapController(getMessageContextController)
)

conversationRouter.get(
  '/:conversation_id/search',
  conversationIdParamValidator,
  messageSearchQueryValidator,
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

conversationRouter.delete(
  '/messages/:message_id/react',
  messageIdParamValidator,
  wrapController(unreactMessageController)
)

conversationRouter.get(
  '/messages/:message_id/reactions',
  messageIdParamValidator,
  wrapController(getMessageReactionsController)
)

conversationRouter.patch(
  '/messages/:message_id',
  editMessageValidator,
  wrapController(editMessageController)
)

conversationRouter.post(
  '/messages/:message_id/forward',
  forwardMessageValidator,
  wrapController(forwardMessageController)
)

conversationRouter.post(
  '/:conversation_id/mute',
  muteConversationValidator,
  wrapController(muteConversationController)
)

conversationRouter.delete(
  '/:conversation_id/mute',
  unmuteConversationValidator,
  wrapController(unmuteConversationController)
)

export default conversationRouter
