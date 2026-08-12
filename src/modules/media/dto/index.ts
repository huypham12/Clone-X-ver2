import { SuccessResponseDto } from '~/common/success-response.dto'
import { MediaStatus } from '~/constants/enums'
import { MediaMetadata } from '~/schemas'

export type UploadMediaMetadataDto = Omit<MediaMetadata, 'status'> & {
  status: MediaStatus.Ready | MediaStatus.Pending
}

export class UploadMediaResponseDto extends SuccessResponseDto<UploadMediaMetadataDto[]> {
  constructor(statusCode: number, message: string, data: MediaMetadata[]) {
    super(statusCode, message, data as UploadMediaMetadataDto[])
  }
}
