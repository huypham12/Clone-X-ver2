import { Router } from 'express'
import { uploadImageController, uploadVideoController, uploadAudioController, getMediaController, deleteMediaController } from './media.controller'
import { wrapController } from '~/utils/wrap-controller'
import { authenticateAccessToken } from '~/middleware/verify.middleware'
import { accessTokenValidator } from '../auth/auth.validator'

const mediaRouter = Router()

mediaRouter.post(
  '/upload-image',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(uploadImageController)
)

mediaRouter.post(
  '/upload-video',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(uploadVideoController)
)

mediaRouter.post(
  '/upload-audio',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(uploadAudioController)
)

mediaRouter.get(
  '/:media_id',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(getMediaController)
)

mediaRouter.delete(
  '/:media_id',
  accessTokenValidator,
  authenticateAccessToken,
  wrapController(deleteMediaController)
)

export default mediaRouter
