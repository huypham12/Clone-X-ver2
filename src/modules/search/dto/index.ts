import { SuccessResponseDto } from '~/common/success-response.dto'

export class SearchQueryDto {
  constructor(
    public q: string,
    public page: number,
    public limit: number
  ) {}
}

export class SearchTweetsQueryDto extends SearchQueryDto {
  constructor(
    q: string,
    page: number,
    limit: number,
    public type?: 'all' | 'media'
  ) {
    super(q, page, limit)
  }
}

export class SearchResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
