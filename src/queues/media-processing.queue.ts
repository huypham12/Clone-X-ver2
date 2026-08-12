import { Queue } from 'bullmq'
import { connection } from '~/config/redisConfig'
import { envConfig } from '~/config/getEnvConfig'
import { createBullMqJobId } from './bullmq-job-id'
import { createQueueJobOptions } from './queue-options'
import { MediaProcessingJobData } from '~/modules/media/media-processing-job.type'

export const MEDIA_PROCESSING_QUEUE_NAME = 'media-processing'
export const MEDIA_PROCESSING_JOB_NAME = 'process-media-v1'

let mediaProcessingQueue: Queue<MediaProcessingJobData> | undefined

const getMediaProcessingQueue = (): Queue<MediaProcessingJobData> => {
  mediaProcessingQueue ??= new Queue<MediaProcessingJobData>(MEDIA_PROCESSING_QUEUE_NAME, { connection })
  return mediaProcessingQueue
}

const createMediaProcessingJobId = (version: number, mediaId: string): string =>
  createBullMqJobId(MEDIA_PROCESSING_JOB_NAME, String(version), mediaId)

export const enqueueMediaProcessing = async (data: MediaProcessingJobData): Promise<void> => {
  await getMediaProcessingQueue().add(MEDIA_PROCESSING_JOB_NAME, data, {
    ...createQueueJobOptions(envConfig.media.queueMaxAttempts),
    jobId: createMediaProcessingJobId(data.version, data.media_id)
  })
}

export const getMediaProcessingJobState = async (mediaId: string) => {
  const job = await getMediaProcessingQueue().getJob(createMediaProcessingJobId(1, mediaId))
  if (!job) return 'missing' as const
  return job.getState()
}

export const closeMediaProcessingQueue = async (): Promise<void> => {
  await mediaProcessingQueue?.close()
  mediaProcessingQueue = undefined
}
