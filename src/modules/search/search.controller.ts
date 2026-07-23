import { Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import searchService from './search.service'
import { GetHandler } from '~/types/controller-handler.type'
import { SearchQueryDto, SearchResponseDto, SearchTweetsQueryDto } from './dto'

export const searchUsersController: GetHandler<SearchResponseDto, any, SearchQueryDto> = async (req, res) => {
  const { q, page, limit } = req.query as any

  const result = await searchService.searchUsers(q, Number(page), Number(limit))

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search users successfully', result)
  res.status(response.statusCode).json(response)
}

export const searchTweetsController: GetHandler<SearchResponseDto, any, SearchTweetsQueryDto> = async (req, res) => {
  const { q, type, page, limit } = req.query as any

  const result = await searchService.searchTweets(q, type, Number(page), Number(limit))

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search tweets successfully', result)
  res.status(response.statusCode).json(response)
}

export const searchHashtagsController: GetHandler<SearchResponseDto, any, { q: string }> = async (req, res) => {
  const { q } = req.query as any

  const result = await searchService.searchHashtags(q)

  const response = new SearchResponseDto(HTTP_STATUS.OK, 'Search hashtags successfully', result)
  res.status(response.statusCode).json(response)
}
