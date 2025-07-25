import { config } from 'dotenv'
import minimist from 'minimist'

// Parse command-line arguments
const args = minimist(process.argv.slice(2))
export const isProduction = args.env === 'production'

console.log(`[ENV] Loaded: ${args.env || 'default'} | isProduction: ${isProduction}`)

// Load the appropriate .env file
config({
  path: args.env ? `.env.${args.env}` : '.env'
})

// Helper to safely get env vars
const getEnvVar = (key: string, required = true): string => {
  const value = process.env[key]
  if (!value && required) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value || ''
}

// Group of env keys to auto-map (optional – DRY)
const dbCollections = [
  'USERS',
  'REFRESH_TOKEN',
  'FOLLOWERS',
  'TWEETS',
  'HASHTAGS',
  'BOOKMARKS',
  'LIKES',
  'CONVERSATIONS'
]

// Export config object
export const getEnvConfig = () => {
  const DB_COLLECTIONS = Object.fromEntries(
    dbCollections.map((name) => [name + '_COLLECTION', getEnvVar(`DB_${name}_COLLECTION`)])
  )

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
