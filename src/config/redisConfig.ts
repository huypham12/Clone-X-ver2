import Redis from 'ioredis'
import { envConfig } from './getEnvConfig'

// Khởi tạo Redis connection dùng chung cho BullMQ
// BullMQ yêu cầu instance của ioredis thay vì node-redis thông thường
export const connection = new Redis(envConfig.redis.url, {
  maxRetriesPerRequest: null // Bắt buộc cho BullMQ
})

connection.on('error', (err) => {
  console.error('[BullMQ Redis] Connection Error:', err)
})

connection.on('connect', () => {
  console.log('[BullMQ Redis] Connected Successfully')
})
