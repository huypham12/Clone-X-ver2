import DatabaseService from '~/config/database.service'
import { RegisterBodyDto, RegisterData, RegisterResponseDto } from './dto'
import { ObjectId } from 'mongodb'
import { User } from '~/schemas'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { TokenType, UserVerifyStatus } from '~/constants/enums'
import { signToken } from '~/utils/jwt'
import { hashPassword } from '~/utils/crypto'
import { getEnvConfig } from '~/config/getEnvConfig'

const envConfig = getEnvConfig()

export class AuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  private signAccessToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: {
        user_id,
        token_type: TokenType.AccessToken,
        verify
      },
      secretKey: envConfig.SECRETS.JWT.ACCESS as string,
      options: {
        algorithm: 'HS256',
        // cái này nó là dạng chuỗi đặc biệt để định dạng Date
        expiresIn: envConfig.TOKEN_EXPIRES.ACCESS as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`
      }
    })
  }

  private signRefreshToken({ user_id, verify, exp }: { user_id: string; verify: UserVerifyStatus; exp?: number }) {
    const payload = {
      user_id,
      token_type: TokenType.RefreshToken,
      verify,
      ...(exp && { exp }) // chỉ nhận giây
    }

    return signToken({
      payload,
      secretKey: envConfig.SECRETS.JWT.REFRESH as string,
      options: {
        algorithm: 'HS256',
        ...(exp
          ? {}
          : {
              expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`
            }) // khi tạo mới thì cần có exp, còn khi refresh thì không cần
      }
    })
  }

  private signEmailVerifyToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: {
        user_id,
        token_type: TokenType.EmailVerifyToken,
        verify: UserVerifyStatus.Unverified
      },
      secretKey: envConfig.SECRETS.JWT.EMAIL_VERIFY as string,
      options: {
        algorithm: 'HS256',
        // cái này nó là dạng chuỗi đặc biệt để định dạng Date
        expiresIn: envConfig.TOKEN_EXPIRES.EMAIL_VERIFY as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`
      }
    })
  }

  private signAccessAndRefreshToken({
    user_id,
    verify,
    exp
  }: {
    user_id: string
    verify: UserVerifyStatus
    exp?: number
  }) {
    return Promise.all([this.signAccessToken({ user_id, verify }), this.signRefreshToken({ user_id, verify, exp })])
  }

  register = async (payload: RegisterBodyDto): Promise<RegisterResponseDto> => {
    // sau khi đăng ký thì thêm vào db và tạo các token gửi về cho người dùng
    const user_id = new ObjectId()
    const email_verify_token = await this.signEmailVerifyToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Unverified
    })
    const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Unverified
    })
    const result = await this.databaseService.users.insertOne(
      new User({
        ...payload,
        _id: user_id,
        date_of_birth: new Date(payload.date_of_birth),
        password: hashPassword(payload.password),
        username: `user${user_id.toString()}`,
        email_verify_token: email_verify_token
      })
    )
    // nên trả về kết quả của việc insert để sau này có thể lấy insertedId dùng cho việc tạo token gì đó (tạm thời chưa biết)

    // send email verify token cho người dùng chờ tạo được aws thì làm

    // Tạo RegisterData từ user insert
    const registerData: RegisterData = {
      access_token,
      refresh_token,
      email_verify_token
    }

    // Trả về RegisterResponseDto
    return new RegisterResponseDto(registerData)
  }
}
