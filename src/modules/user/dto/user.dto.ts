import { SuccessResponseDto } from '~/common/success-response.dto'
import { UserVerifyStatus } from '~/constants/enums'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'

export interface UserPublicDTO {
  name: string
  date_of_birth: Date
  bio?: string
  location?: string
  website?: string
  username?: string
  avatar?: string
  cover_photo?: string
}

export interface UserPrivateDTO extends UserPublicDTO {
  email: string
  created_at?: Date
  updated_at?: Date
  verify?: UserVerifyStatus
}

export class UserResponseDto extends SuccessResponseDto {
  user: UserPublicDTO | UserPrivateDTO
  constructor(user: UserPublicDTO | UserPrivateDTO) {
    super(HTTP_STATUS.OK, MESSAGES.GET_USER_PROFILE_SUCCESS)
    this.user = user
  }
}
