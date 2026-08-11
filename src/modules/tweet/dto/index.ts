import { SuccessResponseDto } from '~/common/success-response.dto'
import { TweetAudience, TweetType } from '~/constants/enums'
import { Tweet } from '~/schemas'

export class CreateTweetBodyDto {
  constructor(
    public type: TweetType,
    public audience: TweetAudience,
    public content: string,
    public parent_id: string | null,
    public hashtags: string[],
    public mentions: string[],
    public medias: string[]
  ) {}
}

export class CreateTweetResponseDto extends SuccessResponseDto<Tweet> {
  constructor(statusCode: number, message: string, data: Tweet) {
    super(statusCode, message, data)
  }
}

export class GetTweetResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class LikeTweetResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
export class PaginationQueryDto {
  constructor(
    public cursor: string | undefined,
    public limit: number
  ) {}
}

export class GetTweetChildrenResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class GetNewFeedsResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
export class BookmarkTweetResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
