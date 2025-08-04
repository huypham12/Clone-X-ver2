import DatabaseService from '~/config/database.service'
import { RegisterBodyDto, RegisterData, RegisterResponseDto } from './dto'
import { ObjectId } from 'mongodb'
import { User } from '~/schemas'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { authMessage } from '~/constants/messages'

export class AuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  register = async (payload: RegisterBodyDto): Promise<RegisterResponseDto> => {
    // sau khi đăng ký thì thêm vào db và tạo các token gửi về cho người dùng
    const user_id = new ObjectId()
    // const email_verify_token = await this.signEmailVerifyToken({
    //   user_id: user_id.toString(),
    //   verify: UserVerifyStatus.Unverified
    // })
    // const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
    //   user_id: user_id.toString(),
    //   verify: UserVerifyStatus.Unverified
    // })
    // const result = await this.databaseService.users.insertOne(
    //   new User({
    //     ...payload,
    //     _id: user_id,
    //     date_of_birth: new Date(payload.date_of_birth),
    //     password: payload.password,
    //     username: `user${user_id.toString()}`,
    //     email_verify_token: ''
    //   })
    // )
    // nên trả về kết quả của việc insert để sau này có thể lấy insertedId dùng cho việc tạo token gì đó (tạm thời chưa biết)

    // Tạo RegisterData từ user insert
    const registerData: RegisterData = {
      access_token: 'someAccessToken',
      refresh_token: 'someRefreshToken',
      email_verify_token: 'someEmailVerifyToken'
    }

    // Trả về RegisterResponseDto
    return new RegisterResponseDto(registerData)
  }
}
