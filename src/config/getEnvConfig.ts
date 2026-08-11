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
    trustProxyHops: number
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
  secrets: {
    jwt: {
      access: string
      refresh: string
    }
  }
  tokenExpires: {
    access: string
    refresh: string
  }
  redis: {
    url: string
  }
  cloudinary: {
    cloudName: string
    apiKey: string
    apiSecret: string
  }
  features: {
    notificationOutboxEnabled: boolean
    notificationFollowOutboxEnabled: boolean
    notificationTweetOutboxEnabled: boolean
    notificationSocialAggregationEnabled: boolean
    notificationMessageDirectedEnabled: boolean
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

const dbCollectionDefaults = {
  USERS: 'users',
  REFRESH_TOKEN: 'refresh-token',
  FOLLOWERS: 'followers',
  TWEETS: 'tweets',
  HASHTAGS: 'hashtags',
  BOOKMARKS: 'bookmarks',
  LIKES: 'likes',
  MESSAGES: 'messages',
  DIRECT_CONVERSATIONS: 'direct-conversations',
  GROUP_CONVERSATIONS: 'group-conversations',
  USER_BLOCKS: 'user-blocks',
  MEDIAS: 'medias',
  NEWSFEEDS: 'newsFeeds',
  NOTIFICATIONS: 'notifications',
  OUTBOX_EVENTS: 'outboxEvents',
  NOTIFICATION_STATES: 'notificationStates',
  NOTIFICATION_ACTORS: 'notificationActors',
  NOTIFICATION_LIFECYCLE_GUARDS: 'notificationLifecycleGuards',
  CONVERSATION_READ_STATES: 'conversationReadStates',
  USER_MESSAGE_STATES: 'userMessageStates'
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

const getTrustProxyHopsEnvVar = (key: string, defaultValue: number): number => {
  const rawValue = getEnvVar(key, false, String(defaultValue))
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) {
    throw new Error(`${key} must be an integer between 0 and 10`)
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

const mongodbUri = getEnvVar('MONGODB_URI', false)
const dbClusterHost = mongodbUri ? '' : getEnvVar('DB_CLUSTER_HOST')
const dbUsername = mongodbUri ? '' : getEnvVar('DB_USERNAME')
const dbPassword = mongodbUri ? '' : getEnvVar('DB_PASSWORD')

// Export configuration
export const envConfig: EnvConfig = {
  app: {
    port: getPortEnvVar('PORT', 3000),
    trustProxyHops: getTrustProxyHopsEnvVar('TRUST_PROXY_HOPS', 0)
  },
  cors: {
    origin: getCsvEnvVar('CORS_ORIGIN', 'http://localhost:3001,http://localhost:5173')
  },
  db: {
    uri: mongodbUri,
    clusterHost: dbClusterHost,
    username: dbUsername,
    password: dbPassword,
    name: getEnvVar('DB_NAME'),
    collections: {
      users: getEnvVar(dbCollections.USERS, false, dbCollectionDefaults.USERS),
      refreshToken: getEnvVar(dbCollections.REFRESH_TOKEN, false, dbCollectionDefaults.REFRESH_TOKEN),
      followers: getEnvVar(dbCollections.FOLLOWERS, false, dbCollectionDefaults.FOLLOWERS),
      tweets: getEnvVar(dbCollections.TWEETS, false, dbCollectionDefaults.TWEETS),
      hashtags: getEnvVar(dbCollections.HASHTAGS, false, dbCollectionDefaults.HASHTAGS),
      bookmarks: getEnvVar(dbCollections.BOOKMARKS, false, dbCollectionDefaults.BOOKMARKS),
      likes: getEnvVar(dbCollections.LIKES, false, dbCollectionDefaults.LIKES),
      messages: getEnvVar(dbCollections.MESSAGES, false, dbCollectionDefaults.MESSAGES),
      directConversations: getEnvVar(
        dbCollections.DIRECT_CONVERSATIONS,
        false,
        dbCollectionDefaults.DIRECT_CONVERSATIONS
      ),
      groupConversations: getEnvVar(dbCollections.GROUP_CONVERSATIONS, false, dbCollectionDefaults.GROUP_CONVERSATIONS),
      userBlocks: getEnvVar(dbCollections.USER_BLOCKS, false, dbCollectionDefaults.USER_BLOCKS),
      medias: getEnvVar(dbCollections.MEDIAS, false, dbCollectionDefaults.MEDIAS),
      newsFeeds: getEnvVar(dbCollections.NEWSFEEDS, false, dbCollectionDefaults.NEWSFEEDS),
      notifications: getEnvVar(dbCollections.NOTIFICATIONS, false, dbCollectionDefaults.NOTIFICATIONS),
      outboxEvents: getEnvVar(dbCollections.OUTBOX_EVENTS, false, dbCollectionDefaults.OUTBOX_EVENTS),
      notificationStates: getEnvVar(dbCollections.NOTIFICATION_STATES, false, dbCollectionDefaults.NOTIFICATION_STATES),
      notificationActors: getEnvVar(dbCollections.NOTIFICATION_ACTORS, false, dbCollectionDefaults.NOTIFICATION_ACTORS),
      notificationLifecycleGuards: getEnvVar(
        dbCollections.NOTIFICATION_LIFECYCLE_GUARDS,
        false,
        dbCollectionDefaults.NOTIFICATION_LIFECYCLE_GUARDS
      ),
      conversationReadStates: getEnvVar(
        dbCollections.CONVERSATION_READ_STATES,
        false,
        dbCollectionDefaults.CONVERSATION_READ_STATES
      ),
      userMessageStates: getEnvVar(dbCollections.USER_MESSAGE_STATES, false, dbCollectionDefaults.USER_MESSAGE_STATES)
    }
  },
  secrets: {
    jwt: {
      access: getEnvVar('JWT_SECRET_ACCESS_TOKEN'),
      refresh: getEnvVar('JWT_SECRET_REFRESH_TOKEN')
    }
  },
  tokenExpires: {
    access: getEnvVar('ACCESS_TOKEN_EXPIRES_IN'),
    refresh: getEnvVar('REFRESH_TOKEN_EXPIRES_IN')
  },
  redis: {
    url: getEnvVar('REDIS_URL', false, 'redis://localhost:6379')
  },
  cloudinary: {
    cloudName: getEnvVar('CLOUDINARY_CLOUD_NAME'),
    apiKey: getEnvVar('CLOUDINARY_API_KEY'),
    apiSecret: getEnvVar('CLOUDINARY_API_SECRET')
  },
  features: {
    notificationOutboxEnabled: getBooleanEnvVar('NOTIFICATION_OUTBOX_ENABLED', true),
    notificationFollowOutboxEnabled: getBooleanEnvVar('NOTIFICATION_FOLLOW_OUTBOX_ENABLED', true),
    notificationTweetOutboxEnabled: getBooleanEnvVar('NOTIFICATION_TWEET_OUTBOX_ENABLED', true),
    notificationSocialAggregationEnabled: getBooleanEnvVar('NOTIFICATION_SOCIAL_AGGREGATION_ENABLED', true),
    notificationMessageDirectedEnabled: getBooleanEnvVar('NOTIFICATION_MESSAGE_DIRECTED_ENABLED', true),
    notificationGroupManagementEnabled: getBooleanEnvVar('NOTIFICATION_GROUP_MANAGEMENT_ENABLED', true),
    notificationFollowedTweetEnabled: getBooleanEnvVar('NOTIFICATION_FOLLOWED_TWEET_ENABLED', true)
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
