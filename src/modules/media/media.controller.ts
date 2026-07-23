import { Request, Response } from 'express'
import { handleUploadImage, handleUploadVideo } from '~/utils/file'
import { uploadImageToCloudinary, uploadVideoToCloudinary } from '~/utils/cloudinary'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import DatabaseService from '~/config/database.service'
import { MediaMetadata } from '~/schemas'
import { MediaType, MediaStatus } from '~/constants/enums'
import { ObjectId } from 'mongodb'
import { PostHandler } from '~/types/controller-handler.type'
import { UploadMediaResponseDto } from './dto'
import { videoQueue } from '~/queues/video.queue'

const databaseService = new DatabaseService()

export const uploadImageController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const files = await handleUploadImage(req)
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)

  const result = await Promise.all(
    files.map(async (file) => {
      const uploadResult = await uploadImageToCloudinary(file.filepath)
      const media = new MediaMetadata({
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        type: MediaType.Image,
        uploaded_by: user_id
      })
      await databaseService.medias.insertOne(media)
      return media
    })
  )

  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, MESSAGES.UPLOAD_IMAGE_SUCCESS, result)
  res.status(response.statusCode).json(response)
}

export const uploadVideoController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const files = await handleUploadVideo(req)
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)
  
  const result = await Promise.all(
    files.map(async (file) => {
      // 1. Lưu DB với trạng thái Pending
      const media = new MediaMetadata({
        type: MediaType.Video,
        status: MediaStatus.Pending,
        uploaded_by: user_id
      })
      await databaseService.medias.insertOne(media)

      // 2. Thêm job vào BullMQ
      await videoQueue.add('upload-video-job', {
        filepath: file.filepath,
        mediaId: media._id.toString()
      })

      return media
    })
  )

  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, 'Videos are being processed', result)
  res.status(response.statusCode).json(response)
}
