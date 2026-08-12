import { Job, Worker } from 'bullmq'
import { ObjectId } from 'mongodb'
import DatabaseService, { databaseService } from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'
import { connection } from '~/config/redisConfig'
import { MediaStatus } from '~/constants/enums'
import { MEDIA_PROCESSING_QUEUE_NAME } from '~/queues/media-processing.queue'
import { InlineMediaProcessor } from './inline-media.processor'
import { MediaProcessingJobData } from './media-processing-job.type'

export class MediaProcessingWorker {
  private readonly worker: Worker<MediaProcessingJobData>
  private readonly inlineProcessor = new InlineMediaProcessor()
  private started = false

  constructor(private readonly database: DatabaseService = databaseService) {
    this.worker = new Worker<MediaProcessingJobData>(MEDIA_PROCESSING_QUEUE_NAME, (job) => this.process(job), {
      connection,
      autorun: false,
      concurrency: envConfig.media.workerConcurrency
    })
    this.worker.on('error', (error) => {
      console.error(`[Media Worker] Uncaught error (${error.name})`)
    })
  }

  async start(): Promise<void> {
    if (!this.started) {
      this.started = true
      void this.worker.run().catch((error: unknown) => {
        console.error(`[Media Worker] Stopped unexpectedly (${error instanceof Error ? error.name : 'unknown'})`)
      })
    }
    await this.worker.waitUntilReady()
  }

  async close(): Promise<void> {
    await this.worker.close(false)
  }

  private async process(job: Job<MediaProcessingJobData>): Promise<void> {
    let objectId: ObjectId | undefined
    try {
      const { version, media_id, durable_source: durableSource } = job.data
      if (version !== 1 || durableSource.provider !== 'cloudinary') throw new Error('Unsupported media job payload')
      if (!ObjectId.isValid(media_id)) throw new Error('Invalid media id in queue payload')

      objectId = new ObjectId(media_id)
      const media = await this.database.medias.findOne({ _id: objectId })
      if (!media || media.status !== MediaStatus.Pending) return

      if (!media.public_id || media.public_id !== durableSource.public_id || !media.url) {
        throw new Error('Pending media durable source does not match its queue job')
      }
      const processed = await this.inlineProcessor.process({
        media_id,
        type: media.type,
        secure_url: media.url,
        public_id: media.public_id
      })
      await this.database.medias.updateOne(
        { _id: objectId, status: MediaStatus.Pending, public_id: media.public_id },
        {
          $set: {
            status: MediaStatus.Ready,
            thumbnail: processed.thumbnail || '',
            updated_at: new Date()
          }
        }
      )
    } catch (error) {
      if (objectId && this.isFinalAttempt(job)) {
        await this.markFailed(objectId)
      }
      throw error
    }
  }

  private isFinalAttempt(job: Job<MediaProcessingJobData>): boolean {
    const attempts = Number(job.opts.attempts ?? envConfig.media.queueMaxAttempts)
    return job.attemptsMade + 1 >= attempts
  }

  private async markFailed(mediaId: ObjectId): Promise<void> {
    try {
      await this.database.medias.updateOne(
        { _id: mediaId, status: MediaStatus.Pending },
        { $set: { status: MediaStatus.Failed, updated_at: new Date() } }
      )
    } catch (error: unknown) {
      console.error(
        `[Media Worker] Could not persist terminal failure (${error instanceof Error ? error.name : 'unknown'})`
      )
    }
  }
}
