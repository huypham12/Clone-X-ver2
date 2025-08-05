import { extend } from 'lodash'
import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

export class ResendVerifyEmailBodyDto {
  constructor(public email: string) {}
}

export class ResendVerifyEmailResponseDto extends SuccessResponseDto<null> {
  constructor() {
    super(HTTP_STATUS.OK, MESSAGES.RESEND_VERIFY_EMAIL_SUCCESS, null)
  }
}
