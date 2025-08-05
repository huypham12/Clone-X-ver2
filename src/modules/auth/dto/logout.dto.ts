import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'

export class LogoutBodyDto {
  constructor(public refresh_token: string) {}
}

export class LogoutResponseDto extends SuccessResponseDto<void> {
  constructor(public message: string) {
    super(HTTP_STATUS.OK, message)
  }
}
