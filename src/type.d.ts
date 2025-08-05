import { TokenPayload } from './types/token-payload.type'
import { User } from '~/schemas/user.schema'
import { Tweet } from '~/schemas/tweet.schema'

declare module 'express' {
  interface Request {
    user?: User
    decoded_email_verify_token?: TokenPayload
    decoded_authorization?: TokenPayload
    decoded_forgot_password_token?: TokenPayload
    decoded_refresh_token?: TokenPayload
    tweet?: Tweet
  }
}
