import { createClient, RedisClientType } from 'redis'
import { envConfig } from './getEnvConfig'

class RedisService {
  private client: RedisClientType

  constructor() {
    this.client = createClient({
      url: envConfig.redis.url
    })

    this.client.on('error', (err) => console.log('Redis Client Error', err))
    this.client.on('connect', () => console.log('Redis Connected Successfully'))
  }

  async connect() {
    await this.client.connect()
  }

  async disconnect() {
    await this.client.disconnect()
  }

  // Tiện ích lấy Cache
  async get(key: string): Promise<any | null> {
    const data = await this.client.get(key)
    return data ? JSON.parse(data) : null
  }

  // Tiện ích Set Cache (mặc định TTL 1 tiếng)
  async set(key: string, value: any, ttlInSeconds = 3600): Promise<void> {
    await this.client.set(key, JSON.stringify(value), {
      EX: ttlInSeconds
    })
  }

  // Xóa Cache
  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  get clientInstance(): RedisClientType {
    return this.client
  }
}

const redisService = new RedisService()
export default redisService
