import { Queue } from 'bullmq'
import { connection } from '~/config/redisConfig'

export const NOTIFICATION_QUEUE_NAME = 'notification-events'
export const NOTIFICATION_JOB_NAME = 'process-domain-event'
export const NOTIFICATION_JOB_ATTEMPTS = 8

export interface NotificationJobData {
  event_id: string
}

export interface NotificationJobResult {
  event_id: string
  status: 'processed' | 'already_processed'
}

export const notificationQueue = new Queue<NotificationJobData, NotificationJobResult>(NOTIFICATION_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: NOTIFICATION_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 50_000 }
  }
})
