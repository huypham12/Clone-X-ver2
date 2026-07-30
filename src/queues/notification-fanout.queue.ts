import { Queue } from 'bullmq'
import { connection } from '~/config/redisConfig'

export const NOTIFICATION_FANOUT_QUEUE_NAME = 'notification-fanout'
export const NOTIFICATION_FANOUT_JOB_NAME = 'fanout-followed-user-tweet'
export const NOTIFICATION_FANOUT_JOB_ATTEMPTS = 8
export const NOTIFICATION_FANOUT_BATCH_SIZE = 500

export interface NotificationFanoutJobData {
  event_id: string
  after_relation_id?: string
}

export interface NotificationFanoutJobResult {
  event_id: string
  processed_recipients: number
  continuation_enqueued: boolean
}

export const createNotificationFanoutJobId = (eventId: string, afterRelationId?: string): string =>
  `${eventId}--${afterRelationId ?? 'first'}`

export const notificationFanoutQueue = new Queue<NotificationFanoutJobData, NotificationFanoutJobResult>(
  NOTIFICATION_FANOUT_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: {
      attempts: NOTIFICATION_FANOUT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 20_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 50_000 }
    }
  }
)
