import { MediaStatus, MediaType } from '~/constants/enums'
import { MediaProcessorPort, ProcessMediaInput, ProcessMediaResult } from './media-processor.port'

export class InlineMediaProcessor implements MediaProcessorPort {
  async process(input: ProcessMediaInput): Promise<ProcessMediaResult> {
    return {
      status: MediaStatus.Ready,
      thumbnail: input.type === MediaType.Video ? input.secure_url.replace(/\.[^/.]+$/, '.jpg') : undefined
    }
  }
}
