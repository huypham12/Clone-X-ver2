import { SuccessResponseDto } from '~/common/success-response.dto'
import { UserVerifyStatus } from '~/constants/enums'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { ObjectId } from 'mongodb'

export interface UserPublicDTO {
  _id?: ObjectId
  name: string
  date_of_birth: Date
  bio?: string
  location?: string
  website?: string
  username?: string
  avatar?: string
  cover_photo?: string
  follower_count?: number
  following_count?: number
  is_following?: boolean
  is_blocked?: boolean
  is_blocked_by_user?: boolean
}

export interface UserPrivateDTO extends UserPublicDTO {
  email: string
  created_at?: Date
  updated_at?: Date
  verify?: UserVerifyStatus
}

export class UserResponseDto extends SuccessResponseDto<UserPublicDTO[] | UserPrivateDTO[]> {
  constructor(user: UserPublicDTO | UserPrivateDTO | UserPublicDTO[] | UserPrivateDTO[]) {
    super(HTTP_STATUS.OK, MESSAGES.GET_USER_PROFILE_SUCCESS, Array.isArray(user) ? user : [user])
  }
}
