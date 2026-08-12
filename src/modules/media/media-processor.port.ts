import { MediaStatus, MediaType } from '~/constants/enums'

export type ProcessMediaInput = {
  media_id: string
  type: MediaType
  secure_url: string
  public_id: string
}

export type ProcessMediaResult = {
  status: MediaStatus.Pending | MediaStatus.Ready
  thumbnail?: string
}

export interface MediaProcessorPort {
  process(input: ProcessMediaInput): Promise<ProcessMediaResult>
}
