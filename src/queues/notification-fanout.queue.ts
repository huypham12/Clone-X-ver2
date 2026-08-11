import { Queue } from 'bullmq'
import { connection } from '~/config/redisConfig'
import { createBullMqJobId } from './bullmq-job-id'
import { createQueueJobOptions } from './queue-options'

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
  createBullMqJobId('notification-fanout', eventId, afterRelationId ?? 'first')

export const notificationFanoutQueue = new Queue<NotificationFanoutJobData, NotificationFanoutJobResult>(
  NOTIFICATION_FANOUT_QUEUE_NAME,
  {
    connection,
    defaultJobOptions: createQueueJobOptions(NOTIFICATION_FANOUT_JOB_ATTEMPTS)
  }
)
