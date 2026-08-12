import { Queue } from 'bullmq'
import { connection } from '~/config/redisConfig'
import { createBullMqJobId } from './bullmq-job-id'
import { createQueueJobOptions } from './queue-options'

export const NOTIFICATION_QUEUE_NAME = 'notification-events'
export const NOTIFICATION_JOB_NAME = 'process-domain-event'
export const NOTIFICATION_JOB_ATTEMPTS = 8

export const createNotificationJobId = (eventId: string): string => createBullMqJobId('notification-event', eventId)

export interface NotificationJobData {
  event_id: string
}

export interface NotificationJobResult {
  event_id: string
  status: 'processed' | 'already_processed'
}

export const notificationQueue = new Queue<NotificationJobData, NotificationJobResult>(NOTIFICATION_QUEUE_NAME, {
  connection,
  defaultJobOptions: createQueueJobOptions(NOTIFICATION_JOB_ATTEMPTS)
})
