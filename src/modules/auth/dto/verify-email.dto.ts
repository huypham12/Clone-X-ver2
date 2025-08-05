import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'

export class VerifyEmailResponseDto extends SuccessResponseDto<{
  message: string
}> {
  constructor(message: string) {
    super(HTTP_STATUS.OK, message)
  }
}
