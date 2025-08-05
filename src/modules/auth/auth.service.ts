import DatabaseService from '~/config/database.service'
import { LoginData, LoginResponseDto, RegisterBodyDto, RegisterData, RegisterResponseDto } from './dto'
import { ObjectId } from 'mongodb'
import { RefreshToken, User } from '~/schemas'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { TokenType, UserVerifyStatus } from '~/constants/enums'
import { signToken, verifyToken } from '~/utils/jwt'
import { hashPassword } from '~/utils/crypto'
import { envConfig } from '~/config/getEnvConfig'
import { HttpError } from '~/common/http-error'

export class AuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  private signAccessToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: {
        user_id,
        token_type: TokenType.AccessToken,
        verify
      },
      secretKey: envConfig.secrets.jwt.access as string,
      options: {
        algorithm: 'HS256',
        // cái này nó là dạng chuỗi đặc biệt để định dạng Date
        expiresIn: envConfig.tokenExpires.access as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`
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
      secretKey: envConfig.secrets.jwt.refresh as string,
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
      secretKey: envConfig.secrets.jwt.emailVerify as string,
      options: {
        algorithm: 'HS256',
        // cái này nó là dạng chuỗi đặc biệt để định dạng Date
        expiresIn: envConfig.tokenExpires.emailVerify as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`
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

  private decodeRefreshToken(token: string) {
    return verifyToken({
      token,
      secretKey: envConfig.secrets.jwt.refresh as string
    })
  }

  register = async (payload: RegisterBodyDto): Promise<RegisterResponseDto> => {
    // sau khi đăng ký thì thêm vào db và tạo các token gửi về cho người dùng
    const user_id = new ObjectId()

    //tạo token trả về
    const email_verify_token = await this.signEmailVerifyToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Unverified
    })
    const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Unverified
    })

    // lưu refresh token vào db
    const { exp } = await this.decodeRefreshToken(refresh_token)
    if (!exp) {
      throw new HttpError(MESSAGES.INVALID_REFRESH_TOKEN, HTTP_STATUS.BAD_REQUEST)
    }
    await this.databaseService.refreshTokens.insertOne(
      new RefreshToken({
        token: refresh_token,
        created_at: new Date(),
        user_id,
        exp // Convert seconds to milliseconds if exp exists
      })
    )

    // insert user
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

  login = async (payload: { email: string; password: string }): Promise<LoginResponseDto> => {
    // tìm user theo email
    const user = await this.databaseService.users.findOne({ email: payload.email })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // kiểm tra mật khẩu
    if (user.password !== hashPassword(payload.password)) {
      throw new HttpError(MESSAGES.INVALID_PASSWORD, HTTP_STATUS.UNAUTHORIZED)
    }

    // nếu user chưa verify thì trả về lỗi
    if (user.verify === UserVerifyStatus.Unverified) {
      throw new HttpError(MESSAGES.USER_NOT_VERIFIED, HTTP_STATUS.FORBIDDEN)
    }

    // tạo access token và refresh token
    const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
      user_id: user._id.toString(),
      verify: user.verify
    })

    console.log(access_token, refresh_token)

    // lưu refresh token vào db
    const { user_id, exp } = await this.decodeRefreshToken(refresh_token)
    console.log(exp, user_id)
    if (!exp) {
      throw new HttpError(MESSAGES.INVALID_REFRESH_TOKEN, HTTP_STATUS.BAD_REQUEST)
    }
    await this.databaseService.refreshTokens.insertOne(
      new RefreshToken({
        token: refresh_token,
        created_at: new Date(),
        user_id: new ObjectId(user_id),
        exp // Convert seconds to milliseconds if exp exists
      })
    )

    // Tạo LoginData từ user login
    const loginData: LoginData = {
      access_token,
      refresh_token
    }

    // Trả về LoginResponseDto
    return new LoginResponseDto(loginData)
  }
}
