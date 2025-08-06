import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

export class ResetPasswordBodyDto {
  constructor(
    public token: string,
    public new_password: string
  ) {}
}

export interface ResetPasswordData {
  access_token: string
  refresh_token: string
}

export class ResetPasswordResponseDto extends SuccessResponseDto<ResetPasswordData> {
  constructor(data: ResetPasswordData) {
    super(HTTP_STATUS.OK, MESSAGES.PASSWORD_RESET_SUCCESS, data)
  }
}
