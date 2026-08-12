import DatabaseService from '~/config/database.service'
import {
  LoginData,
  LoginResponseDto,
  RegisterBodyDto,
  LogoutResponseDto,
  RefreshTokenResponseDto,
  ChangePasswordResponseDto,
  RegisterResponseData
} from '../dto'
import { ObjectId } from 'mongodb'
import { RefreshToken, User } from '~/schemas'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { TokenType, UserVerifyStatus } from '~/constants/enums'
import { signTokenByType, verifyToken } from '~/utils/jwt'
import { comparePassword, hashPassword } from '~/utils/crypto'
import { envConfig } from '~/config/getEnvConfig'
import { HttpError } from '~/common/http-error'

export class AuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  private signAccessToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }): Promise<string> {
    return signTokenByType({
      user_id,
      verify,
      token_type: TokenType.AccessToken,
      secretKey: envConfig.secrets.jwt.access as string,
      expiresIn: envConfig.tokenExpires.access
    })
  }

  private signRefreshToken({
    user_id,
    verify,
    exp
  }: {
    user_id: string
    verify: UserVerifyStatus
    exp?: number
  }): Promise<string> {
    return signTokenByType({
      user_id,
      verify,
      token_type: TokenType.RefreshToken,
      secretKey: envConfig.secrets.jwt.refresh as string,
      expiresIn: exp ? undefined : envConfig.tokenExpires.refresh,
      exp
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
  }): Promise<[string, string]> {
    return Promise.all([this.signAccessToken({ user_id, verify }), this.signRefreshToken({ user_id, verify, exp })])
  }

  private decodeToken(token: string, secretKey: string) {
    return verifyToken({
      token,
      secretKey
    })
  }

  checkEmailExists = async (email: string) => {
    const existingUser = await this.databaseService.users.findOne({ email })
    if (existingUser) {
      throw new HttpError(MESSAGES.EMAIL_ALREADY_EXISTS, HTTP_STATUS.BAD_REQUEST)
    }
  }

  // hiện tại thì đăng ký chưa cho nhập luôn username, chờ làm được cái search nhanh thì mới cho nhập được vì check username đã tồn tại chưa khá lâu
  register = async (payload: RegisterBodyDto): Promise<RegisterResponseData> => {
    // sau khi đăng ký thì thêm vào db và tạo các token gửi về cho người dùng
    const user_id = new ObjectId()
    // Portfolio auth does not depend on email delivery; new accounts are active immediately.
    const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Verified
    })
    // lưu refresh token vào db
    const { exp } = await this.decodeToken(refresh_token, envConfig.secrets.jwt.refresh as string)
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
    await this.databaseService.users.insertOne(
      new User({
        ...payload,
        date_of_birth: new Date(payload.date_of_birth),
        _id: user_id,
        password: await hashPassword(payload.password),
        username: `user${user_id.toString()}`,
        email_verify_token: '', // Không cần token nữa vì đã verify sẵn
        verify: UserVerifyStatus.Verified // Tạm thời set trạng thái đã xác minh
      })
    )
    // Tạo RegisterResponseData để trả về
    const registerResponseData: RegisterResponseData = {
      access_token,
      refresh_token
    }
    // Trả về RegisterResponseDto
    return registerResponseData
  }

  login = async (payload: { email: string; password: string }): Promise<LoginResponseDto> => {
    // tìm user theo email
    const user = await this.databaseService.users.findOne({ email: payload.email })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    // nếu user chưa verify thì trả về lỗi
    if (user.verify === UserVerifyStatus.Unverified) {
      throw new HttpError(MESSAGES.USER_NOT_VERIFIED, HTTP_STATUS.FORBIDDEN)
    }

    const isMatch = await comparePassword(payload.password, user.password)
    // kiểm tra mật khẩu
    if (!isMatch) {
      throw new HttpError(MESSAGES.INVALID_PASSWORD, HTTP_STATUS.UNAUTHORIZED)
    }

    // tạo access token và refresh token
    const [access_token, refresh_token] = await this.signAccessAndRefreshToken({
      user_id: user._id.toString(),
      verify: user.verify
    })

    // lưu refresh token vào db
    const { user_id, exp } = await this.decodeToken(refresh_token, envConfig.secrets.jwt.refresh as string)

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

  logout = async (refresh_token: string): Promise<LogoutResponseDto> => {
    await this.databaseService.refreshTokens.deleteOne({ token: refresh_token })
    return new LogoutResponseDto(MESSAGES.LOGOUT_SUCCESS)
  }

  refreshToken = async ({
    refresh_token,
    user_id,
    verify,
    exp
  }: {
    refresh_token: string
    user_id: string
    verify: UserVerifyStatus
    exp: number
  }): Promise<RefreshTokenResponseDto> => {
    //tạo token mới để trả về
    const [refreshToken, accessToken] = await Promise.all([
      this.signRefreshToken({ user_id, verify, exp }), // vẫn cùng exp với refresh_token cũ
      this.signAccessToken({ user_id, verify }),
      this.databaseService.refreshTokens.deleteOne({ token: refresh_token })
    ])

    await this.databaseService.refreshTokens.insertOne(
      new RefreshToken({ user_id: new ObjectId(user_id), token: refreshToken, exp })
    )
    return new RefreshTokenResponseDto({ access_token: accessToken, refresh_token: refreshToken })
  }

  changePassword = async ({
    old_password,
    new_password,
    user_id
  }: {
    old_password: string
    new_password: string
    user_id: string
  }): Promise<ChangePasswordResponseDto> => {
    const user = await this.databaseService.users.findOne({ _id: new ObjectId(user_id) })
    if (!user) {
      throw new HttpError(MESSAGES.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
    }

    const isMatch = await comparePassword(old_password, user.password)
    if (!isMatch) {
      throw new HttpError(MESSAGES.INVALID_OLD_PASSWORD, HTTP_STATUS.BAD_REQUEST)
    }

    const hashedPassword = await hashPassword(new_password)
    await this.databaseService.users.updateOne(
      { _id: new ObjectId(user_id) },
      {
        $set: {
          password: hashedPassword
        },
        $currentDate: { updated_at: true }
      }
    )

    return new ChangePasswordResponseDto()
  }
}
