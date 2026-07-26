import { Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { SuccessResponseDto } from '~/common/success-response.dto'
import searchService from './search.service'
import { GetHandler } from '~/types/controller-handler.type'
import { SearchQueryDto, SearchResponseDto, SearchTweetsQueryDto } from './dto'

export const searchUsersController: GetHandler<SearchResponseDto, any, SearchQueryDto> = async (req, res) => {
  const { q, cursor, limit } = req.query as any
  const user_id = (req as any).decoded_authorization.user_id

  const result = await searchService.searchUsers(q, cursor, Number(limit))
  if (q && user_id && !cursor) {
    await searchService.addSearchHistory(user_id, q)
  }

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search users successfully', result)
  res.status(response.statusCode).json(response)
}

export const searchTweetsController: GetHandler<SearchResponseDto, any, SearchTweetsQueryDto> = async (req, res) => {
  const { q, type, cursor, limit } = req.query as any
  const user_id = (req as any).decoded_authorization.user_id

  const result = await searchService.searchTweets(q, type, cursor, Number(limit))
  if (q && user_id && !cursor) {
    await searchService.addSearchHistory(user_id, q)
  }

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search tweets successfully', result)
  res.status(response.statusCode).json(response)
}

export const searchHashtagsController: GetHandler<SearchResponseDto, any, { q: string }> = async (req, res) => {
  const { q } = req.query as any
  const user_id = (req as any).decoded_authorization.user_id

  const result = await searchService.searchHashtags(q)
  if (q && user_id) {
    await searchService.addSearchHistory(user_id, q)
  }

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search hashtags successfully', result)
  res.status(response.statusCode).json(response)
}

export const getSearchHistoryController: GetHandler<any> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const result = await searchService.getSearchHistory(user_id)
  res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get search history successfully', result))
}

export const deleteSearchHistoryController: GetHandler<any> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  await searchService.deleteSearchHistory(user_id)
  res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Delete search history successfully'))
}

export const getHashtagTweetsController: GetHandler<any> = async (req, res) => {
  const { tag } = req.params
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)
  const user_id = (req as any).decoded_authorization?.user_id

  const result = await searchService.getHashtagTweets(tag, cursor, limit, user_id)
  res.json(new SuccessResponseDto(HTTP_STATUS.OK, 'Get hashtag tweets successfully', result))
}
