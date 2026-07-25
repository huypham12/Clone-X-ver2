import { Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import tweetService from './tweet.service'
import { GetHandler, PostHandler, DeleteHandler } from '~/types/controller-handler.type'
import { SuccessResponseDto } from '~/common/success-response.dto'
import {
  CreateTweetBodyDto,
  CreateTweetResponseDto,
  GetTweetResponseDto,
  LikeTweetResponseDto,
  BookmarkTweetResponseDto,
  GetTweetChildrenResponseDto,
  GetNewFeedsResponseDto,
  PaginationQueryDto
} from './dto'

export const createTweetController: PostHandler<CreateTweetBodyDto, CreateTweetResponseDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const result = await tweetService.createTweet(user_id, (req as any).validatedData.body)

  const response = new CreateTweetResponseDto(HTTP_STATUS.CREATED, 'Tweet created successfully', result as any)
  res.status(response.statusCode).json(response)
}

export const updateTweetController: PostHandler<any, any, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  
  const result = await tweetService.updateTweet(user_id, tweet_id, (req as any).validatedData.body)

  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Tweet updated successfully', result as any)
  res.status(response.statusCode).json(response)
}

export const getTweetController: GetHandler<GetTweetResponseDto, { tweet_id: string }> = async (req, res) => {
  const { tweet_id } = req.params
  const user_id = (req as any).decoded_authorization?.user_id
  const result = await tweetService.getTweet(tweet_id, user_id)
  
  if (!result) {
    const response = new GetTweetResponseDto(HTTP_STATUS.NOT_FOUND, 'Tweet not found', null)
    res.status(response.statusCode).json(response)
    return
  }

  const response = new GetTweetResponseDto(HTTP_STATUS.OK, 'Get tweet successfully', result)
  res.status(response.statusCode).json(response)
}

export const likeTweetController: PostHandler<any, LikeTweetResponseDto, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  const result = await tweetService.likeTweet(user_id, tweet_id)
  
  const response = new LikeTweetResponseDto(HTTP_STATUS.OK, 'Like tweet successfully', result)
  res.status(response.statusCode).json(response)
}

export const unlikeTweetController: DeleteHandler<LikeTweetResponseDto, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  const result = await tweetService.unlikeTweet(user_id, tweet_id)
  
  const response = new LikeTweetResponseDto(HTTP_STATUS.OK, 'Unlike tweet successfully', result)
  res.status(response.statusCode).json(response)
}

export const unretweetController: DeleteHandler<any, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  const result = await tweetService.unretweet(user_id, tweet_id)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Undo retweet successfully', result as any)
  res.status(response.statusCode).json(response)
}

export const bookmarkTweetController: PostHandler<any, BookmarkTweetResponseDto, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  const result = await tweetService.bookmarkTweet(user_id, tweet_id)
  
  const response = new BookmarkTweetResponseDto(HTTP_STATUS.OK, 'Bookmark tweet successfully', result)
  res.status(response.statusCode).json(response)
}

export const unbookmarkTweetController: DeleteHandler<BookmarkTweetResponseDto, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params
  const result = await tweetService.unbookmarkTweet(user_id, tweet_id)
  
  const response = new BookmarkTweetResponseDto(HTTP_STATUS.OK, 'Unbookmark tweet successfully', result)
  res.status(response.statusCode).json(response)
}

export const getTweetChildrenController: GetHandler<GetTweetChildrenResponseDto, { tweet_id: string }, PaginationQueryDto> = async (req, res) => {
  const { tweet_id } = req.params
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)
  const user_id = (req as any).decoded_authorization?.user_id
  
  const result = await tweetService.getTweetChildren({ tweet_id, cursor, limit, user_id })
  
  const response = new GetTweetChildrenResponseDto(HTTP_STATUS.OK, 'Get tweet children successfully', result)
  res.status(response.statusCode).json(response)
}

export const getNewFeedsController: GetHandler<GetNewFeedsResponseDto, any, PaginationQueryDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)
  
  const result = await tweetService.getNewFeeds({ user_id, cursor, limit })
  
  const response = new GetNewFeedsResponseDto(HTTP_STATUS.OK, 'Get new feeds successfully', result)
  res.status(response.statusCode).json(response)
}

export const getForYouFeedsController: GetHandler<GetNewFeedsResponseDto, any, PaginationQueryDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)
  
  const result = await tweetService.getForYouFeeds({ user_id, cursor, limit })
  
  const response = new GetNewFeedsResponseDto(HTTP_STATUS.OK, 'Get for you feeds successfully', result)
  res.status(response.statusCode).json(response)
}

export const deleteTweetController: DeleteHandler<SuccessResponseDto, { tweet_id: string }> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const { tweet_id } = req.params

  await tweetService.deleteTweet(user_id, tweet_id)

  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Delete tweet successfully', null)
  res.status(response.statusCode).json(response)
}

export const getBookmarksController: GetHandler<any, any, PaginationQueryDto> = async (req, res) => {
  const user_id = (req as any).decoded_authorization.user_id
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)

  const result = await tweetService.getBookmarks(user_id, cursor, limit)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Get bookmarks successfully', result)
  res.status(response.statusCode).json(response)
}

export const getTweetLikesController: GetHandler<any, { tweet_id: string }, PaginationQueryDto> = async (req, res) => {
  const { tweet_id } = req.params
  const cursor = (req.query as any).cursor as string | undefined
  const limit = Number((req.query as any).limit)

  const result = await tweetService.getTweetLikes(tweet_id, cursor, limit)
  
  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Get tweet likes successfully', result)
  res.status(response.statusCode).json(response)
}
