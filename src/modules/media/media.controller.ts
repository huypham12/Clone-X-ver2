import { HTTP_STATUS } from '~/constants/httpStatus'
import { MESSAGES } from '~/constants/messages'
import { MediaType } from '~/constants/enums'
import { ObjectId } from 'mongodb'
import { PostHandler, GetHandler, DeleteHandler } from '~/types/controller-handler.type'
import { UploadMediaResponseDto } from './dto'
import { SuccessResponseDto } from '~/common/success-response.dto'
import { mediaService } from './media.service'

export const uploadImageController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)
  const result = await mediaService.upload(req, MediaType.Image, user_id)

  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, MESSAGES.UPLOAD_IMAGE_SUCCESS, result)
  res.status(response.statusCode).json(response)
}

export const uploadVideoController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)
  const result = await mediaService.upload(req, MediaType.Video, user_id)
  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, 'Upload video accepted', result)
  res.status(response.statusCode).json(response)
}

export const uploadAudioController: PostHandler<any, UploadMediaResponseDto> = async (req, res) => {
  const user_id = new ObjectId((req as any).decoded_authorization.user_id)
  const result = await mediaService.upload(req, MediaType.Audio, user_id)

  const response = new UploadMediaResponseDto(HTTP_STATUS.OK, 'Upload audio successfully', result)
  res.status(response.statusCode).json(response)
}

export const getMediaController: GetHandler<any, { media_id: string }> = async (req, res) => {
  const { media_id } = req.params
  const media = await mediaService.get(new ObjectId(media_id))

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

  await mediaService.delete(new ObjectId(media_id), user_id)

  const response = new SuccessResponseDto(HTTP_STATUS.OK, 'Delete media successfully', null)
  res.status(response.statusCode).json(response)
}
