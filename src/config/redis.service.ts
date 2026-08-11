import { createClient, RedisClientType } from 'redis'
import { envConfig } from './getEnvConfig'

const REDIS_STARTUP_TIMEOUT_MS = 10_000

class RedisService {
  private readonly client: RedisClientType
  readonly pubClient: RedisClientType
  readonly subClient: RedisClientType

  constructor() {
    this.client = createClient({
      url: envConfig.redis.url
    })

    this.pubClient = this.client.duplicate()
    this.subClient = this.client.duplicate()

    this.registerErrorHandler(this.client, 'cache')
    this.registerErrorHandler(this.pubClient, 'socket-pub')
    this.registerErrorHandler(this.subClient, 'socket-sub')
  }

  async connect(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.all([
          this.ensureConnected(this.client),
          this.ensureConnected(this.pubClient),
          this.ensureConnected(this.subClient)
        ]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Redis startup timed out after ${REDIS_STARTUP_TIMEOUT_MS}ms`)),
            REDIS_STARTUP_TIMEOUT_MS
          )
        })
      ])
      console.log('Redis cache and Socket.IO adapter clients are ready')
    } catch (error: unknown) {
      await this.disconnect()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([
      this.closeClient(this.client),
      this.closeClient(this.pubClient),
      this.closeClient(this.subClient)
    ])
  }

  async ping(): Promise<void> {
    if (!this.client.isReady) throw new Error('Redis cache client is not ready')
    await this.client.ping()
  }

  // Tiện ích lấy Cache
  async get(key: string): Promise<unknown | null> {
    const data = await this.client.get(key)
    return data ? JSON.parse(data) : null
  }

  // Tiện ích Set Cache (mặc định TTL 1 tiếng)
  async set(key: string, value: unknown, ttlInSeconds = 3600): Promise<void> {
    const serializedValue = JSON.stringify(value)
    if (serializedValue === undefined) throw new TypeError('Redis cache value must be JSON-serializable')
    await this.client.set(key, serializedValue, {
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

  private async ensureConnected(client: RedisClientType): Promise<void> {
    if (!client.isOpen) await client.connect()
    await client.ping()
  }

  private async closeClient(client: RedisClientType): Promise<void> {
    if (!client.isOpen) return
    if (client.isReady) {
      await client.quit()
      return
    }
    client.destroy()
  }

  private registerErrorHandler(client: RedisClientType, clientName: string): void {
    client.on('error', (error: Error) => {
      console.error(`[Redis ${clientName}]`, error.message)
    })
  }
}

const redisService = new RedisService()
export default redisService
