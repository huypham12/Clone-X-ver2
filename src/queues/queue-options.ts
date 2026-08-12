import type { DefaultJobOptions } from 'bullmq'
import { envConfig } from '~/config/getEnvConfig'

const ONE_HOUR_SECONDS = 60 * 60
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

export const createQueueJobOptions = (attempts: number): DefaultJobOptions => ({
  attempts,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: {
    age: ONE_HOUR_SECONDS,
    count: envConfig.queue.completedRetentionCount
  },
  removeOnFail: {
    age: SEVEN_DAYS_SECONDS,
    count: envConfig.queue.failedRetentionCount
  }
})
