import { Request } from 'express'
import { ObjectId } from 'mongodb'
import { HttpError } from '~/common/http-error'
import { databaseService } from '~/config/database.service'
import { envConfig } from '~/config/getEnvConfig'
import { MediaStatus, MediaType } from '~/constants/enums'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MediaMetadata } from '~/schemas'
import {
  cleanupUploadedFiles,
  handleUploadAudio,
  handleUploadImage,
  handleUploadVideo,
  ParsedMediaUpload
} from '~/utils/file'
import { BullMqMediaProcessor } from './bullmq-media.processor'
import { CloudinaryMediaStorage } from './cloudinary-media.storage'
import { InlineMediaProcessor } from './inline-media.processor'
import { MediaProcessorPort } from './media-processor.port'
import { DurableMediaAsset, MediaStoragePort } from './media-storage.port'

const uploadHandlerByType: Record<
  MediaType.Image | MediaType.Video | MediaType.Audio,
  (req: Request) => Promise<ParsedMediaUpload>
> = {
  [MediaType.Image]: handleUploadImage,
  [MediaType.Video]: handleUploadVideo,
  [MediaType.Audio]: handleUploadAudio
}

export class MediaService {
  constructor(
    private readonly storage: MediaStoragePort = new CloudinaryMediaStorage(),
    private readonly processor: MediaProcessorPort = envConfig.media.processingMode === 'queue'
      ? new BullMqMediaProcessor()
      : new InlineMediaProcessor()
  ) {}

  async upload(
    req: Request,
    mediaType: MediaType.Image | MediaType.Video | MediaType.Audio,
    uploadedBy: ObjectId
  ): Promise<MediaMetadata[]> {
    const parsedUpload = await uploadHandlerByType[mediaType](req)
    try {
      if (parsedUpload.error) throw parsedUpload.error

      const medias: MediaMetadata[] = []
      for (const file of parsedUpload.files) {
        medias.push(await this.uploadOne(file.filepath, mediaType, uploadedBy))
      }
      return medias
    } finally {
      await cleanupUploadedFiles(parsedUpload.files)
    }
  }

  async get(mediaId: ObjectId): Promise<MediaMetadata | null> {
    return databaseService.medias.findOne({ _id: mediaId })
  }

  async delete(mediaId: ObjectId, userId: string): Promise<void> {
    const media = await databaseService.medias.findOne({ _id: mediaId })
    if (!media) throw new HttpError('Media not found', HTTP_STATUS.NOT_FOUND)
    if (media.uploaded_by?.toString() !== userId) {
      throw new HttpError('You do not have permission to delete this media', HTTP_STATUS.FORBIDDEN)
    }

    if (media.public_id) {
      const resourceType = media.type === MediaType.Image ? 'image' : 'video'
      const deleteResult = await this.storage.delete(media.public_id, resourceType)
      if (deleteResult === 'failed') {
        throw new HttpError('Could not delete media from storage', HTTP_STATUS.BAD_GATEWAY)
      }
    }

    await databaseService.medias.deleteOne({ _id: mediaId })
  }

  private async uploadOne(
    filepath: string,
    mediaType: MediaType.Image | MediaType.Video | MediaType.Audio,
    uploadedBy: ObjectId
  ): Promise<MediaMetadata> {
    const asset = await this.storage.upload(filepath, mediaType)
    if (!asset.secure_url || !asset.public_id) {
      await this.compensateStorageUpload(asset)
      throw new HttpError('Storage did not return a durable media reference', HTTP_STATUS.BAD_GATEWAY)
    }

    let media: MediaMetadata
    try {
      media = new MediaMetadata({
        url: asset.secure_url,
        public_id: asset.public_id,
        type: mediaType,
        status: envConfig.media.processingMode === 'queue' ? MediaStatus.Pending : MediaStatus.Ready,
        uploaded_by: uploadedBy
      })

      if (envConfig.media.processingMode === 'inline') {
        const processed = await this.processor.process({
          media_id: media._id.toString(),
          type: media.type,
          secure_url: media.url,
          public_id: media.public_id
        })
        media.status = processed.status
        media.thumbnail = processed.thumbnail || ''
      }

      await databaseService.medias.insertOne(media)
    } catch (error) {
      await this.compensateStorageUpload(asset)
      throw error
    }

    if (envConfig.media.processingMode === 'queue') {
      try {
        await this.processor.process({
          media_id: media._id.toString(),
          type: media.type,
          secure_url: media.url,
          public_id: media.public_id
        })
      } catch (error: unknown) {
        console.error(
          `[Media] Queue unavailable; media ${media._id.toString()} remains pending for reconciliation (${error instanceof Error ? error.name : 'unknown'})`
        )
      }
    }

    return media
  }

  private async compensateStorageUpload(asset: DurableMediaAsset): Promise<void> {
    try {
      const result = await this.storage.delete(asset.public_id, asset.resource_type)
      if (result === 'failed') console.error('[Media] Storage compensation did not delete uploaded asset')
    } catch (error: unknown) {
      console.error('[Media] Storage compensation failed', error)
    }
  }
}

export const mediaService = new MediaService()
