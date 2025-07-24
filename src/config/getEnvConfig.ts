import { config } from 'dotenv'
import minimist from 'minimist'

// lấy các tham số từ dòng lệnh
const args = minimist(process.argv.slice(2))
export const isProduction = args.env === 'production'

console.log(`[ENV] Loaded: ${args.env || 'default'} | isProduction: ${isProduction}`)

// truyền biến môi trường vào dotenv
config({
  path: args.env ? `.env.${args.env}` : '.env'
})

// Lấy biến môi trường
const getEnvVar = (key: string, required = true): string => {
  const value = process.env[key] //  các biến trong file .env
  if (!value && required) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value || ''
}

// tạo danh sách các collection của database để dễ quản lý
const dbCollections = [
  'USERS',
  'REFRESH_TOKEN',
  'FOLLOWERS',
  'TWEETS',
  'HASHTAGS',
  'BOOKMARKS',
  'LIKES',
  'MESSAGES',
  'DIRECT_CONVERSATIONS',
  'GROUP_CONVERSATIONS'
]

// Export config object
export const getEnvConfig = () => {
  // chuyển [key, value] thành { key: value }
  const DB_COLLECTIONS = Object.fromEntries(
    dbCollections.map((name) => [name + '_COLLECTION', getEnvVar(`DB_${name}_COLLECTION`)])
    // cái hàm getEnvVar sẽ kiểm tra xem mấy db này có tồn tại trong file .env hay không
  )

  // trả về các cụm cấu hình cho dễ quản lý
  return {
    APP: {
      PORT: parseInt(getEnvVar('PORT')),
      HOST: getEnvVar('HOST')
    },
    DB: {
      USERNAME: getEnvVar('DB_USERNAME'),
      PASSWORD: getEnvVar('DB_PASSWORD'),
      NAME: getEnvVar('DB_NAME'),
      ...DB_COLLECTIONS
    },
    GOOGLE: {
      CLIENT_ID: getEnvVar('GOOGLE_CLIENT_ID'),
      CLIENT_SECRET: getEnvVar('GOOGLE_CLIENT_SECRET'),
      REDIRECT_URI: getEnvVar('GOOGLE_REDIRECT_URI')
    },
    CLIENT_REDIRECT_URI: getEnvVar('CLIENT_REDIRECT_URI'),
    SECRETS: {
      PASSWORD: getEnvVar('PASSWORD_SECRET'),
      JWT: {
        ACCESS: getEnvVar('JWT_SECRET_ACCESS_TOKEN'),
        REFRESH: getEnvVar('JWT_SECRET_REFRESH_TOKEN'),
        EMAIL_VERIFY: getEnvVar('JWT_SECRET_EMAIL_VERIFY_TOKEN'),
        FORGOT_PASSWORD: getEnvVar('JWT_SECRET_FORGOT_PASSWORD_TOKEN')
      }
    },
    TOKEN_EXPIRES: {
      ACCESS: getEnvVar('ACCESS_TOKEN_EXPIRES_IN'),
      REFRESH: getEnvVar('REFRESH_TOKEN_EXPIRES_IN'),
      EMAIL_VERIFY: getEnvVar('EMAIL_VERIFY_TOKEN_EXIPIRES_IN'),
      FORGOT_PASSWORD: getEnvVar('FORGOT_PASSWORD_TOKEN_EXIPIRES_IN')
    }
  }
}
