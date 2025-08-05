import jwt, { SignOptions, TokenExpiredError, VerifyOptions } from 'jsonwebtoken'
import { promisify } from 'util'
import { HttpError } from '~/common/http-error'
import { MESSAGES } from '~/constants/messages'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { TokenPayload } from '~/types/token-payload.type'
import { z } from 'zod'

// Promisify jwt.sign và jwt.verify để tránh callback
const signAsync = promisify<string | Buffer | object, string, SignOptions | undefined, string>(jwt.sign)
const verifyAsync = promisify<string, string | Buffer, VerifyOptions | undefined, any>(jwt.verify)

// Schema để validate TokenPayload
const tokenPayloadSchema = z.object({
  user_id: z.string(),
  verify: z.number().optional(),
  token_type: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional()
})

// Hàm signToken
// mấy cái chỗ kiểu dữ liệu này ts nó có cái gọi là function overloads nên phải viết đúng kiểu dữ liệu cụ thể thì mới đc:))) biết thế đã
// cái hàm signToken này nhận vào 3 cái payload (chứa dữ liệu người dùng), secret key và SignOptions dùng để mã hóa thành token. Nó trả về một promise nếu cái hàm sign tạo token thành công thì resolve không thì reject
export const signToken = async ({
  payload,
  secretKey,
  options = { algorithm: 'HS256' }
}: {
  payload: TokenPayload
  secretKey: string
  options?: SignOptions
}): Promise<string> => {
  try {
    const token = await signAsync(payload, secretKey, options)
    return token
  } catch (error) {
    throw new HttpError(MESSAGES.JWT_SIGN_FAILED, HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

// Hàm verifyToken
// hàm này giúp giải mã + xác thực, nếu token gửi lên đúng thì nó trả về cái code đã được giải mã
export const verifyToken = async ({
  token,
  secretKey
}: {
  token: string
  secretKey: string
}): Promise<TokenPayload> => {
  try {
    const decoded = await verifyAsync(token, secretKey, { algorithms: ['HS256'] })
    const validatedPayload = tokenPayloadSchema.parse(decoded)
    return validatedPayload as TokenPayload
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new HttpError(MESSAGES.TOKEN_EXPIRED, HTTP_STATUS.UNAUTHORIZED)
    }
    if (error instanceof z.ZodError) {
      throw new HttpError(MESSAGES.INVALID_TOKEN_PAYLOAD, HTTP_STATUS.UNAUTHORIZED, {
        payload: error.issues.map((err) => err.message)
      })
    }
    throw new HttpError(MESSAGES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED)
  }
}
