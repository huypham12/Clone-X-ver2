import { config } from 'dotenv'
import minimist from 'minimist'

// Parse command-line arguments
const args = minimist(process.argv.slice(2))
export const isProduction = args.env === 'production'

console.log(`[ENV] Loaded: ${args.env || 'default'} | isProduction: ${isProduction}`)

// Load environment variables from .env file
config({
  path: args.env ? `.env.${args.env}` : '.env'
})

// Interface for configuration structure
interface EnvConfig {
  app: {
    port: number
    host: string
  }
  cors: {
    origin: string[]
  }
  db: {
    username: string
    password: string
    name: string
    collections: {
      users: string
      refreshToken: string
      followers: string
      tweets: string
      hashtags: string
      bookmarks: string
      likes: string
      messages: string
      directConversations: string
      groupConversations: string
    }
  }
  google: {
    clientId: string
    clientSecret: string
    redirectUri: string
  }
  clientRedirectUri: string
  secrets: {
    password: string
    jwt: {
      access: string
      refresh: string
      emailVerify: string
      forgotPassword: string
    }
  }
  tokenExpires: {
    access: string
    refresh: string
    emailVerify: string
    forgotPassword: string
  }
  sendGrid: {
    apiKey: string
  }
  resendApiKey: string
}

// Utility function to get environment variable with validation
const getEnvVar = (key: string, required = true, defaultValue?: string): string => {
  const value = process.env[key] || defaultValue
  if (!value && required) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value || ''
}

// Database collections configuration
const dbCollections = {
  USERS: 'DB_USERS_COLLECTION',
  REFRESH_TOKEN: 'DB_REFRESH_TOKEN_COLLECTION',
  FOLLOWERS: 'DB_FOLLOWERS_COLLECTION',
  TWEETS: 'DB_TWEETS_COLLECTION',
  HASHTAGS: 'DB_HASHTAGS_COLLECTION',
  BOOKMARKS: 'DB_BOOKMARKS_COLLECTION',
  LIKES: 'DB_LIKES_COLLECTION',
  MESSAGES: 'DB_MESSAGES_COLLECTION',
  DIRECT_CONVERSATIONS: 'DB_DIRECT_CONVERSATIONS_COLLECTION',
  GROUP_CONVERSATIONS: 'DB_GROUP_CONVERSATIONS_COLLECTION'
}

// Export configuration
export const envConfig: EnvConfig = {
  app: {
    port: parseInt(getEnvVar('PORT', true, '3000')),
    host: getEnvVar('HOST', true, 'http://localhost:3000')
  },
  cors: {
    origin: getEnvVar('CORS_ORIGIN', false, 'http://localhost:3001,http://localhost:5173').split(',')
  },
  db: {
    username: getEnvVar('DB_USERNAME'),
    password: getEnvVar('DB_PASSWORD'),
    name: getEnvVar('DB_NAME'),
    collections: {
      users: getEnvVar(dbCollections.USERS),
      refreshToken: getEnvVar(dbCollections.REFRESH_TOKEN),
      followers: getEnvVar(dbCollections.FOLLOWERS),
      tweets: getEnvVar(dbCollections.TWEETS),
      hashtags: getEnvVar(dbCollections.HASHTAGS),
      bookmarks: getEnvVar(dbCollections.BOOKMARKS),
      likes: getEnvVar(dbCollections.LIKES),
      messages: getEnvVar(dbCollections.MESSAGES),
      directConversations: getEnvVar(dbCollections.DIRECT_CONVERSATIONS),
      groupConversations: getEnvVar(dbCollections.GROUP_CONVERSATIONS)
    }
  },
  google: {
    clientId: getEnvVar('GOOGLE_CLIENT_ID'),
    clientSecret: getEnvVar('GOOGLE_CLIENT_SECRET'),
    redirectUri: getEnvVar('GOOGLE_REDIRECT_URI')
  },
  clientRedirectUri: getEnvVar('CLIENT_REDIRECT_URI'),
  secrets: {
    password: getEnvVar('PASSWORD_SECRET'),
    jwt: {
      access: getEnvVar('JWT_SECRET_ACCESS_TOKEN'),
      refresh: getEnvVar('JWT_SECRET_REFRESH_TOKEN'),
      emailVerify: getEnvVar('JWT_SECRET_EMAIL_VERIFY_TOKEN'),
      forgotPassword: getEnvVar('JWT_SECRET_FORGOT_PASSWORD_TOKEN')
    }
  },
  tokenExpires: {
    access: getEnvVar('ACCESS_TOKEN_EXPIRES_IN'),
    refresh: getEnvVar('REFRESH_TOKEN_EXPIRES_IN'),
    emailVerify: getEnvVar('EMAIL_VERIFY_TOKEN_EXPIRES_IN'),
    forgotPassword: getEnvVar('FORGOT_PASSWORD_TOKEN_EXPIRES_IN')
  },
  sendGrid: {
    apiKey: getEnvVar('SENDGRID_API_KEY')
  },
  resendApiKey: getEnvVar('RESEND_API_KEY')
}

// Optional: Validate critical configurations on initialization
;(() => {
  try {
    // Ensure critical environment variables are present
    const criticalVars = ['PORT', 'HOST', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD']
    criticalVars.forEach((key) => getEnvVar(key))
    console.log('[ENV] All critical environment variables loaded successfully.')
  } catch (error) {
    console.error('[ENV] Configuration validation failed:', error)
    process.exit(1)
  }
})()
