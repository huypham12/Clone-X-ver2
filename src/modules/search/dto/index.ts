import { SuccessResponseDto } from '~/common/success-response.dto'

export class SearchQueryDto {
  constructor(
    public q: string,
    public cursor: string | undefined,
    public limit: number
  ) {}
}

export class SearchTweetsQueryDto extends SearchQueryDto {
  constructor(
    q: string,
    cursor: string | undefined,
    limit: number,
    public type?: 'all' | 'media'
  ) {
    super(q, cursor, limit)
  }
}

export class SearchResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
