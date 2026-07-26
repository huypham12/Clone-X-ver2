import { Request, Response } from 'express'
import { handleUploadImage, handleUploadVideo, handleUploadAudio } from '~/utils/file'
import { uploadImageToCloudinary, uploadVideoToCloudinary, uploadAudioToCloudinary, deleteFromCloudinary } from '~/utils/cloudinary'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import DatabaseService from '~/config/database.service'
import { MediaMetadata } from '~/schemas'
import { MediaType, MediaStatus } from '~/constants/enums'
import { ObjectId } from 'mongodb'
import { PostHandler, GetHandler, DeleteHandler } from '~/types/controller-handler.type'
import { UploadMediaResponseDto } from './dto'
import { SuccessResponseDto } from '~/common/success-response.dto'
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
        status: MediaStatus.Ready,
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

export const uploadAudioController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const files = await handleUploadAudio(req)
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)

  const result = await Promise.all(
    files.map(async (file) => {
      const uploadResult = await uploadAudioToCloudinary(file.filepath)
      const media = new MediaMetadata({
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        type: MediaType.Audio,
        status: MediaStatus.Ready,
        uploaded_by: user_id
      })
      await databaseService.medias.insertOne(media)
      return media
    })
  )

  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, 'Upload audio successfully', result)
  res.status(response.statusCode).json(response)
}

export const getMediaController: GetHandler<any, { media_id: string }> = async (req, res) => {
  const { media_id } = req.params
  const media = await databaseService.medias.findOne({ _id: new ObjectId(media_id) })

  if (!media) {
    const response = new SuccessResponseDto(HTTP_STATUS.NOT_FOUND, 'Media not found', null)
    res.status(response.statusCode).json(response)
    return
  }

  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Get media successfully', media)
  res.status(response.statusCode).json(response)
}

export const deleteMediaController: DeleteHandler<SuccessResponseDto, { media_id: string }> = async (req, res) => {
  const { media_id } = req.params
  const user_id = (req as any).decoded_authorization.user_id
  
  const media = await databaseService.medias.findOne({ _id: new ObjectId(media_id) })

  if (!media) {
    const response = new SuccessResponseDto(HTTP_STATUS.NOT_FOUND, 'Media not found', null)
    res.status(response.statusCode).json(response)
    return
  }

  if (media.uploaded_by?.toString() !== user_id) {
    const response = new SuccessResponseDto(HTTP_STATUS.FORBIDDEN, 'You do not have permission to delete this media', null)
    res.status(response.statusCode).json(response)
    return
  }

  // Xóa trên Cloudinary
  if (media.public_id) {
    const resourceType = media.type === MediaType.Image ? 'image' : 'video' // Cloudinary treats audio as video resource_type
    await deleteFromCloudinary(media.public_id, resourceType)
  }

  // Xóa trong DB
  await databaseService.medias.deleteOne({ _id: new ObjectId(media_id) })

  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Delete media successfully', null)
  res.status(response.statusCode).json(response)
}
