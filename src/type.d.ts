import { TokenPayload } from './types/token-payload.type'
import { User, Tweet } from './schemas'

// mở rộng interface Request của express để thêm các trường tùy chỉnh, không ví dụ nếu dùng req.body.decoded_email_verify_token sẽ báo lỗi
declare module 'express' {
  interface Request {
    user?: User
    decoded_email_verify_token?: TokenPayload
    decoded_authorization?: TokenPayload
    decoded_forgot_password_token?: TokenPayload
    decoded_refresh_token?: TokenPayload
    tweet?: Tweet
    validatedData?: unknown
  }
}
