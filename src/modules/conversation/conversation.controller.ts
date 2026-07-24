import { Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import conversationService from './conversation.service'
import { GetHandler, PostHandler, DeleteHandler, PatchHandler } from '~/types/controller-handler.type'
import { SuccessResponseDto } from '~/common/success-response.dto'
import {
  GetConversationsResponseDto,
  ConversationResponseDto,
  CreateGroupConversationBodyDto,
  GetMessagesResponseDto,
  PaginationQueryDto,
  MessageActionResponseDto,
  ReactMessageBodyDto
} from './dto'
import { SearchQueryDto, SearchResponseDto } from '../search/dto'

export const getConversationsController: GetHandler<GetConversationsResponseDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const result = await conversationService.getConversations(user_id)

  const response = new GetConversationsResponseDto(HTTP_STATUS.OK, 'Get conversations successfully', result)
  res.status(response.statusCode).json(response)
}

export const getDirectConversationController: PostHandler<any, ConversationResponseDto, { receiver_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { receiver_id } = req.params

  const result = await conversationService.getOrCreateDirectConversation(user_id, receiver_id)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Get direct conversation successfully', result)
  res.status(response.statusCode).json(response)
}

export const createGroupConversationController: PostHandler<CreateGroupConversationBodyDto, ConversationResponseDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { name, members, avatar_url } = req.body

  const result = await conversationService.createGroupConversation(user_id, name, members, avatar_url)
  
  const response = new ConversationResponseDto(HTTP_STATUS.CREATED, 'Group created successfully', result)
  res.status(response.statusCode).json(response)
}

export const deleteConversationController: DeleteHandler<ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.deleteConversation(user_id, conversation_id)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Conversation deleted successfully', result)
  res.status(response.statusCode).json(response)
}

export const getMessagesController: GetHandler<GetMessagesResponseDto, { conversation_id: string }, PaginationQueryDto> = async (req, res) => {
  const { conversation_id } = req.params
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)
  
  const result = await conversationService.getMessages(conversation_id, cursor, limit)
  
  const response = new GetMessagesResponseDto(HTTP_STATUS.OK, 'Get messages successfully', result)
  res.status(response.statusCode).json(response)
}

export const markReadController: PostHandler<any, MessageActionResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.markAsRead(user_id, conversation_id)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Marked as read successfully', result)
  res.status(response.statusCode).json(response)
}

export const revokeMessageController: PostHandler<any, MessageActionResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params

  const result = await conversationService.revokeMessage(user_id, message_id)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Message revoked successfully', result)
  res.status(response.statusCode).json(response)
}

export const deleteMessageController: DeleteHandler<MessageActionResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params

  const result = await conversationService.deleteMessage(user_id, message_id)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Message deleted successfully', result)
  res.status(response.statusCode).json(response)
}

export const reactMessageController: PostHandler<ReactMessageBodyDto, MessageActionResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params
  const { emoji } = req.body

  const result = await conversationService.reactMessage(user_id, message_id, emoji)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Reacted to message successfully', result)
  res.status(response.statusCode).json(response)
}

export const pinConversationController: PostHandler<any, ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.pinConversation(user_id, conversation_id)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Conversation pinned successfully', result)
  res.status(response.statusCode).json(response)
}

export const unpinConversationController: DeleteHandler<ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.unpinConversation(user_id, conversation_id)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Conversation unpinned successfully', result)
  res.status(response.statusCode).json(response)
}

export const searchMessagesController: GetHandler<SearchResponseDto, { conversation_id: string }, SearchQueryDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const { q, cursor, limit } = req.query as any

  const result = await conversationService.searchMessages(user_id, conversation_id, q, cursor, Number(limit))
  
  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search messages successfully', result)
  res.status(response.statusCode).json(response)
}

export const getConversationMediaController: GetHandler<GetMessagesResponseDto, { conversation_id: string }, PaginationQueryDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const { cursor, limit } = req.query as any

  const result = await conversationService.getConversationMedia(user_id, conversation_id, cursor, Number(limit))
  
  const response = new GetMessagesResponseDto(HTTP_STATUS.OK, 'Get conversation media successfully', result)
  res.status(response.statusCode).json(response)
}

export const muteConversationController: PostHandler<{ type: 'direct' | 'group', duration_hours?: number }, ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const { type, duration_hours } = req.body

  const result = await conversationService.muteConversation(user_id, conversation_id, type, duration_hours)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Conversation muted successfully', result)
  res.status(response.statusCode).json(response)
}

export const unmuteConversationController: DeleteHandler<ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const type = (req as any).body.type || (req.query as any).type

  const result = await conversationService.unmuteConversation(user_id, conversation_id, type)
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Conversation unmuted successfully', result)
  res.status(response.statusCode).json(response)
}

export const updateGroupController: PatchHandler<any, ConversationResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const { name, avatar_url } = req.body

  const result = await conversationService.updateGroupInfo(user_id, conversation_id, { name, avatar_url })
  
  const response = new ConversationResponseDto(HTTP_STATUS.OK, 'Group updated successfully', result)
  res.status(response.statusCode).json(response)
}

export const getGroupMembersController: GetHandler<SuccessResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.getGroupMembers(user_id, conversation_id)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Get group members successfully', result)
  res.status(response.statusCode).json(response)
}

export const addGroupMembersController: PostHandler<{ members: string[] }, SuccessResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params
  const { members } = req.body

  const result = await conversationService.addGroupMembers(user_id, conversation_id, members)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Add members successfully', result)
  res.status(response.statusCode).json(response)
}

export const removeGroupMemberController: DeleteHandler<SuccessResponseDto, { conversation_id: string, user_id: string }> = async (req, res) => {
  const admin_id = (req as any).decoded_authorization.user_id
  const { conversation_id, user_id } = req.params

  const result = await conversationService.removeGroupMember(admin_id, conversation_id, user_id)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Remove member successfully', result)
  res.status(response.statusCode).json(response)
}

export const leaveGroupController: DeleteHandler<SuccessResponseDto, { conversation_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { conversation_id } = req.params

  const result = await conversationService.leaveGroup(user_id, conversation_id)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Leave group successfully', result)
  res.status(response.statusCode).json(response)
}

export const editMessageController: PatchHandler<{ content: string }, MessageActionResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params
  const { content } = req.body

  const result = await conversationService.editMessage(user_id, message_id, content)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Message edited successfully', result)
  res.status(response.statusCode).json(response)
}

export const unreactMessageController: DeleteHandler<MessageActionResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params

  const result = await conversationService.unreactMessage(user_id, message_id)
  
  const response = new MessageActionResponseDto(HTTP_STATUS.OK, 'Unreacted successfully', result)
  res.status(response.statusCode).json(response)
}

export const getMessageReactionsController: GetHandler<SuccessResponseDto, { message_id: string }> = async (req, res) => {
  const { message_id } = req.params

  const result = await conversationService.getMessageReactions(message_id)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Get reactions successfully', result)
  res.status(response.statusCode).json(response)
}

export const forwardMessageController: PostHandler<{ conversation_ids: string[] }, SuccessResponseDto, { message_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { message_id } = req.params
  const { conversation_ids } = req.body

  const result = await conversationService.forwardMessage(user_id, message_id, conversation_ids)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Forwarded message successfully', result)
  res.status(response.statusCode).json(response)
}
