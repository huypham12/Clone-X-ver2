import { ObjectId } from 'mongodb'
import DatabaseService from '~/config/database.service'
import { UserPrivateDTO, UserPublicDTO } from './dto/user.dto'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { User } from '~/schemas'

export class UserService {
  constructor(private readonly databaseService: DatabaseService) {}
  getMeInfo = async (user_id: string): Promise<UserPrivateDTO> => {
    const user = await this.databaseService.users.findOne(
      { _id: new ObjectId(user_id) },
      {
        // k trả về thông tin nhạy cảm của người dùng
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          refresh_token: 0,
          verify: 0,
          created_at: 0,
          updated_at: 0
        }
      }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }
    return user
  }

  getUserInfoByUsername = async (username: string): Promise<UserPublicDTO> => {
    const user = await this.databaseService.users.findOne(
      { username },
      {
        projection: {
          password: 0,
          email: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          refresh_token: 0,
          verify: 0,
          created_at: 0,
          updated_at: 0
        }
      }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }
    return user
  }

  // partial biến tất cả thuộc tính thành optional
  updateMeInfo = async (user_id: string, updateData: any): Promise<UserPrivateDTO> => {
    const user = await this.databaseService.users.findOneAndUpdate(
      { _id: new ObjectId(user_id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }
    return user
  }
}
