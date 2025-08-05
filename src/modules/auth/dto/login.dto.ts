import { SuccessResponseDto } from '~/common/success-response.dto'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

// REQUEST DTO
export class LoginBodyDto {
  constructor(
    public email: string,
    public password: string
  ) {}
}

// RESPONSE DTO
export interface LoginData {
  access_token: string
  refresh_token: string
}

export class LoginResponseDto extends SuccessResponseDto<LoginData> {
  constructor(data: LoginData) {
    super(HTTP_STATUS.CREATED, MESSAGES.LOGIN_SUCCESS, data)
  }
}
