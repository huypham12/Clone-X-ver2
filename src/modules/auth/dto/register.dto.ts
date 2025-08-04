import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

// REQUEST DTO
export class RegisterBodyDto {
  constructor(
    public name: string,
    public email: string,
    public password: string,
    public confirm_password: string,
    public date_of_birth: string
  ) {}
}

// RESPONSE DTO
export interface RegisterData {
  access_token: string
  refresh_token: string
  email_verify_token: string
}

export class RegisterResponseDto extends SuccessResponseDto<RegisterData> {
  constructor(data: RegisterData) {
    super(HTTP_STATUS.CREATED, MESSAGES.REGISTER_SUCCESS, data)
  }
}
