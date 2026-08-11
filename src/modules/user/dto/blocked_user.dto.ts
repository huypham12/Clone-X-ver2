import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

export class BlockUserResponseDto extends SuccessResponseDto {
  constructor() {
    super(HTTP_STATUS.OK, MESSAGES.USER_BLOCKED)
  }
}

export class UnblockUserResponseDto extends SuccessResponseDto {
  constructor() {
    super(HTTP_STATUS.OK, MESSAGES.USER_UNBLOCKED)
  }
}
