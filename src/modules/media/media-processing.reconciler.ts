import DatabaseService, { databaseService } from '~/config/database.service'
import { MediaStatus } from '~/constants/enums'
import { BullMqMediaProcessor } from './bullmq-media.processor'
import { MediaProcessorPort } from './media-processor.port'
import { getMediaProcessingJobState } from '~/queues/media-processing.queue'

const RECONCILE_INTERVAL_MS = 30_000
const RECONCILE_BATCH_SIZE = 50

export class MediaProcessingReconciler {
  private timer?: NodeJS.Timeout
  private activeScan?: Promise<void>

  constructor(
    private readonly database: DatabaseService = databaseService,
    private readonly processor: MediaProcessorPort = new BullMqMediaProcessor()
  ) {}

  start(): void {
    if (this.timer) return
    void this.scan()
    this.timer = setInterval(() => void this.scan(), RECONCILE_INTERVAL_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.activeScan
  }

  private async scan(): Promise<void> {
    if (this.activeScan) return this.activeScan
    this.activeScan = this.reconcilePending().finally(() => {
      this.activeScan = undefined
    })
    return this.activeScan
  }

  private async reconcilePending(): Promise<void> {
    try {
      const pendingMedia = await this.database.medias
        .find({ status: MediaStatus.Pending, public_id: { $ne: '' } })
        .sort({ updated_at: 1 })
        .limit(RECONCILE_BATCH_SIZE)
        .toArray()

      for (const media of pendingMedia) {
        if (!media.url) continue
        const jobState = await getMediaProcessingJobState(media._id.toString())
        if (jobState === 'failed') {
          await this.database.medias.updateOne(
            { _id: media._id, status: MediaStatus.Pending, public_id: media.public_id },
            { $set: { status: MediaStatus.Failed, updated_at: new Date() } }
          )
          continue
        }
        await this.processor.process({
          media_id: media._id.toString(),
          type: media.type,
          secure_url: media.url,
          public_id: media.public_id
        })
      }
    } catch (error: unknown) {
      console.error(`[Media Reconciler] Scan failed (${error instanceof Error ? error.name : 'unknown'})`)
    }
  }
}
