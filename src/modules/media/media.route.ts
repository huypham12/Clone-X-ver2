import { Router } from 'express'
import { uploadImageController, uploadVideoController } from './media.controller'
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

export default mediaRouter
