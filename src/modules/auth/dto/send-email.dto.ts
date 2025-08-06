import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

export class SendEmailBodyDto {
  constructor(public email: string) {}
}

export class SendEmailResponseDto extends SuccessResponseDto {
  constructor(message: string) {
    super(HTTP_STATUS.OK, message)
  }
}
