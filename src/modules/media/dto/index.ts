import { SuccessResponseDto } from '~/common/success-response.dto'
import { MediaMetadata } from '~/schemas'

export class UploadMediaResponseDto extends SuccessResponseDto<MediaMetadata[]> {
  constructor(statusCode: number, message: string, data: MediaMetadata[]) {
    super(statusCode, message, data)
  }
}
