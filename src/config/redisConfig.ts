import Redis from 'ioredis'
import { envConfig } from './getEnvConfig'

const BULLMQ_REDIS_STARTUP_TIMEOUT_MS = 10_000

// Khởi tạo Redis connection dùng chung cho BullMQ
// BullMQ yêu cầu instance của ioredis thay vì node-redis thông thường
export const connection = new Redis(envConfig.redis.url, {
  connectionName: 'clone-x-bullmq',
  lazyConnect: true,
  maxRetriesPerRequest: null // Bắt buộc cho BullMQ
})

connection.on('error', (err) => {
  console.error('[BullMQ Redis] Connection Error:', err)
})

connection.on('ready', () => {
  console.log('[BullMQ Redis] Ready')
})

export const connectBullMqRedis = async (): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      connection.ping(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`BullMQ Redis startup timed out after ${BULLMQ_REDIS_STARTUP_TIMEOUT_MS}ms`)),
          BULLMQ_REDIS_STARTUP_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const pingBullMqRedis = async (): Promise<void> => {
  if (connection.status !== 'ready') throw new Error('BullMQ Redis connection is not ready')
  await connection.ping()
}

export const disconnectBullMqRedis = async (): Promise<void> => {
  if (connection.status === 'wait' || connection.status === 'end') {
    connection.disconnect()
    return
  }
  await connection.quit()
}
