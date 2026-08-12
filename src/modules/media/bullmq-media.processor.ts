import { MediaStatus } from '~/constants/enums'
import { enqueueMediaProcessing } from '~/queues/media-processing.queue'
import { MediaProcessorPort, ProcessMediaInput, ProcessMediaResult } from './media-processor.port'

export class BullMqMediaProcessor implements MediaProcessorPort {
  async process(input: ProcessMediaInput): Promise<ProcessMediaResult> {
    await enqueueMediaProcessing({
      version: 1,
      media_id: input.media_id,
      durable_source: {
        provider: 'cloudinary',
        public_id: input.public_id
      }
    })
    return { status: MediaStatus.Pending }
  }
}
