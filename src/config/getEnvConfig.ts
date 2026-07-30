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
    uri: string
    clusterHost: string
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
      userBlocks: string
      medias: string
      newsFeeds: string
      notifications: string
      outboxEvents: string
      notificationStates: string
      notificationActors: string
      notificationLifecycleGuards: string
      conversationReadStates: string
      userMessageStates: string
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
  redis: {
    url: string
  }
  features: {
    notificationOutboxEnabled: boolean
    notificationFollowOutboxEnabled: boolean
    notificationTweetOutboxEnabled: boolean
    notificationUnreadStateEnabled: boolean
    notificationSocialAggregationEnabled: boolean
    notificationMessageDirectedEnabled: boolean
    notificationMessageReactionEnabled: boolean
    notificationGroupManagementEnabled: boolean
    notificationFollowedTweetEnabled: boolean
  }
  conversation: {
    maxGroupMembers: number
  }
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
  GROUP_CONVERSATIONS: 'DB_GROUP_CONVERSATIONS_COLLECTION',
  USER_BLOCKS: 'DB_USER_BLOCKS_COLLECTION',
  MEDIAS: 'DB_MEDIAS_COLLECTION',
  NEWSFEEDS: 'DB_NEWSFEEDS_COLLECTION',
  NOTIFICATIONS: 'DB_NOTIFICATIONS_COLLECTION',
  OUTBOX_EVENTS: 'DB_OUTBOX_EVENTS_COLLECTION',
  NOTIFICATION_STATES: 'DB_NOTIFICATION_STATES_COLLECTION',
  NOTIFICATION_ACTORS: 'DB_NOTIFICATION_ACTORS_COLLECTION',
  NOTIFICATION_LIFECYCLE_GUARDS: 'DB_NOTIFICATION_LIFECYCLE_GUARDS_COLLECTION',
  CONVERSATION_READ_STATES: 'DB_CONVERSATION_READ_STATES_COLLECTION',
  USER_MESSAGE_STATES: 'DB_USER_MESSAGE_STATES_COLLECTION'
}

const getBooleanEnvVar = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key]
  if (value === undefined || value === '') return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${key} must be either true or false`)
}

const getPortEnvVar = (key: string, defaultValue: number): number => {
  const rawValue = getEnvVar(key, false, String(defaultValue))
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${key} must be an integer between 1 and 65535`)
  }
  return value
}

const getPositiveIntegerEnvVar = (key: string, defaultValue: number): number => {
  const rawValue = getEnvVar(key, false, String(defaultValue))
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < 3) {
    throw new Error(`${key} must be an integer greater than or equal to 3`)
  }
  return value
}

const getCsvEnvVar = (key: string, defaultValue: string): string[] => {
  const values = getEnvVar(key, false, defaultValue)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (values.length === 0) throw new Error(`${key} must contain at least one value`)
  return values
}

// Export configuration
export const envConfig: EnvConfig = {
  app: {
    port: getPortEnvVar('PORT', 3000),
    host: getEnvVar('HOST', true, 'http://localhost:3000')
  },
  cors: {
    origin: getCsvEnvVar('CORS_ORIGIN', 'http://localhost:3001,http://localhost:5173')
  },
  db: {
    uri: getEnvVar('MONGODB_URI', false),
    clusterHost: getEnvVar('DB_CLUSTER_HOST', false, 'clone-x-ver2.qhuiotw.mongodb.net'),
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
      groupConversations: getEnvVar(dbCollections.GROUP_CONVERSATIONS),
      userBlocks: getEnvVar(dbCollections.USER_BLOCKS),
      medias: getEnvVar(dbCollections.MEDIAS, false, 'medias'),
      newsFeeds: getEnvVar(dbCollections.NEWSFEEDS, false, 'newsFeeds'),
      notifications: getEnvVar(dbCollections.NOTIFICATIONS, false, 'notifications'),
      outboxEvents: getEnvVar(dbCollections.OUTBOX_EVENTS, false, 'outboxEvents'),
      notificationStates: getEnvVar(dbCollections.NOTIFICATION_STATES, false, 'notificationStates'),
      notificationActors: getEnvVar(dbCollections.NOTIFICATION_ACTORS, false, 'notificationActors'),
      notificationLifecycleGuards: getEnvVar(
        dbCollections.NOTIFICATION_LIFECYCLE_GUARDS,
        false,
        'notificationLifecycleGuards'
      ),
      conversationReadStates: getEnvVar(
        dbCollections.CONVERSATION_READ_STATES,
        false,
        'conversationReadStates'
      ),
      userMessageStates: getEnvVar(dbCollections.USER_MESSAGE_STATES, false, 'userMessageStates')
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
  resendApiKey: getEnvVar('RESEND_API_KEY'),
  redis: {
    url: getEnvVar('REDIS_URL', false, 'redis://localhost:6379')
  },
  features: {
    notificationOutboxEnabled: getBooleanEnvVar('NOTIFICATION_OUTBOX_ENABLED', false),
    notificationFollowOutboxEnabled: getBooleanEnvVar('NOTIFICATION_FOLLOW_OUTBOX_ENABLED', false),
    notificationTweetOutboxEnabled: getBooleanEnvVar('NOTIFICATION_TWEET_OUTBOX_ENABLED', false),
    notificationUnreadStateEnabled: getBooleanEnvVar('NOTIFICATION_UNREAD_STATE_ENABLED', false),
    notificationSocialAggregationEnabled: getBooleanEnvVar('NOTIFICATION_SOCIAL_AGGREGATION_ENABLED', false),
    notificationMessageDirectedEnabled: getBooleanEnvVar('NOTIFICATION_MESSAGE_DIRECTED_ENABLED', false),
    notificationMessageReactionEnabled: getBooleanEnvVar('NOTIFICATION_MESSAGE_REACTION_ENABLED', false),
    notificationGroupManagementEnabled: getBooleanEnvVar('NOTIFICATION_GROUP_MANAGEMENT_ENABLED', false),
    notificationFollowedTweetEnabled: getBooleanEnvVar('NOTIFICATION_FOLLOWED_TWEET_ENABLED', false)
  },
  conversation: {
    maxGroupMembers: getPositiveIntegerEnvVar('MAX_GROUP_MEMBERS', 500)
  }
}

const localDevelopmentHosts = new Set(['localhost', '127.0.0.1', '::1'])

export const isCorsOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin || envConfig.cors.origin.includes(origin)) return true
  if (isProduction) return false

  try {
    const parsedOrigin = new URL(origin)
    return (
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
      localDevelopmentHosts.has(parsedOrigin.hostname)
    )
  } catch {
    return false
  }
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
