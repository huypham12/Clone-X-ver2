import { createClient, RedisClientType } from 'redis'
import { envConfig } from './getEnvConfig'

const REDIS_STARTUP_TIMEOUT_MS = 10_000

export interface SocketAdapterRedisClients {
  pubClient: RedisClientType
  subClient: RedisClientType
}

export interface RedisClientStatus {
  isOpen: boolean
  isReady: boolean
}

class RedisService {
  private readonly client: RedisClientType
  private socketClients?: SocketAdapterRedisClients
  private connectPromise?: Promise<void>
  private disconnectPromise?: Promise<void>

  constructor() {
    this.client = createClient({
      url: envConfig.redis.cacheUrl,
      name: 'clone-x-cache'
    })
    this.registerErrorHandler(this.client, 'cache')
  }

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = this.connectRequiredClients()
    try {
      await this.connectPromise
    } finally {
      this.connectPromise = undefined
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise

    const clients = [this.client, this.socketClients?.pubClient, this.socketClients?.subClient].filter(
      (client): client is RedisClientType => client !== undefined
    )
    this.disconnectPromise = Promise.allSettled(clients.map((client) => this.closeClient(client))).then(() => undefined)
    try {
      await this.disconnectPromise
    } finally {
      this.disconnectPromise = undefined
    }
  }

  async ping(): Promise<void> {
    if (!this.client.isReady) throw new Error('Redis cache client is not ready')
    await this.client.ping()
  }

  async get(key: string): Promise<unknown | null> {
    const data = await this.client.get(key)
    return data ? JSON.parse(data) : null
  }

  async set(key: string, value: unknown, ttlInSeconds = 3600): Promise<void> {
    const serializedValue = JSON.stringify(value)
    if (serializedValue === undefined) throw new TypeError('Redis cache value must be JSON-serializable')
    await this.client.set(key, serializedValue, {
      EX: ttlInSeconds
    })
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
  }

  get clientInstance(): RedisClientType {
    return this.client
  }

  get cacheStatus(): RedisClientStatus {
    return { isOpen: this.client.isOpen, isReady: this.client.isReady }
  }

  get socketStatus(): RedisClientStatus | 'disabled' {
    if (!this.socketClients) return 'disabled'
    return {
      isOpen: this.socketClients.pubClient.isOpen && this.socketClients.subClient.isOpen,
      isReady: this.socketClients.pubClient.isReady && this.socketClients.subClient.isReady
    }
  }

  getSocketAdapterClients(): SocketAdapterRedisClients {
    const clients = this.socketClients
    if (!clients?.pubClient.isReady || !clients.subClient.isReady) {
      throw new Error('Socket Redis clients are not ready')
    }
    return clients
  }

  private async connectRequiredClients(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined
    try {
      const clients = [this.client]
      if (envConfig.socket.adapterMode === 'redis') {
        if (!this.socketClients) {
          const pubClient = createClient({
            url: envConfig.redis.socketUrl,
            name: 'clone-x-socket-pub'
          })
          const subClient = pubClient.duplicate()
          this.registerErrorHandler(pubClient, 'socket-pub')
          this.registerErrorHandler(subClient, 'socket-sub')
          this.socketClients = { pubClient, subClient }
        }
        clients.push(this.socketClients.pubClient, this.socketClients.subClient)
      }

      await Promise.race([
        Promise.all(clients.map((client) => this.ensureConnected(client))),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Redis startup timed out after ${REDIS_STARTUP_TIMEOUT_MS}ms`)),
            REDIS_STARTUP_TIMEOUT_MS
          )
        })
      ])
      console.log('[Redis cache] ready')
      if (this.socketClients) console.log('[Redis socket-pub/socket-sub] ready')
    } catch (error: unknown) {
      await this.disconnect()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
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
      console.error(`[Redis ${clientName}] connection error (${error.name})`)
    })
  }
}

const redisService = new RedisService()
export default redisService
