import { Request } from 'express'
import formidable, { File } from 'formidable'
import fs from 'fs'
import path from 'path'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { envConfig } from '~/config/getEnvConfig'

export const UPLOAD_IMAGE_TEMP_DIR = path.resolve('uploads/images/temp')
export const UPLOAD_VIDEO_DIR = path.resolve('uploads/videos')
export const UPLOAD_AUDIO_DIR = path.resolve('uploads/audios')

export const initFolder = () => {
  ;[UPLOAD_IMAGE_TEMP_DIR, UPLOAD_VIDEO_DIR, UPLOAD_AUDIO_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {
        recursive: true
      })
    }
  })
}

export type ParsedMediaUpload = {
  files: File[]
  error?: HttpError
}

type MediaUploadOptions = {
  fieldName: 'image' | 'video' | 'audio'
  mimePrefix: 'image/' | 'video/' | 'audio/'
  uploadDir: string
  maxFiles: number
  maxFileSizeMb: number
}

const parseMediaUpload = async (req: Request, options: MediaUploadOptions): Promise<ParsedMediaUpload> => {
  let rejectedFile = false
  const maxFileSize = options.maxFileSizeMb * 1024 * 1024
  const form = formidable({
    uploadDir: options.uploadDir,
    maxFiles: options.maxFiles,
    keepExtensions: true,
    maxFileSize,
    maxTotalFileSize: maxFileSize * options.maxFiles,
    filter: ({ name, mimetype }) => {
      const valid = name === options.fieldName && Boolean(mimetype?.startsWith(options.mimePrefix))
      if (!valid) rejectedFile = true
      return valid
    }
  })

  return new Promise<ParsedMediaUpload>((resolve) => {
    form.parse(req, (err, _fields, parsedFiles) => {
      const files = (parsedFiles[options.fieldName] || []) as File[]
      if (err) {
        resolve({ files, error: new HttpError(err.message, HTTP_STATUS.BAD_REQUEST) })
        return
      }
      if (rejectedFile) {
        resolve({ files, error: new HttpError('File field or MIME type is not valid', HTTP_STATUS.BAD_REQUEST) })
        return
      }
      if (files.length === 0) {
        resolve({ files, error: new HttpError('File is empty', HTTP_STATUS.BAD_REQUEST) })
        return
      }
      resolve({ files })
    })
  })
}

export const cleanupUploadedFiles = async (files: File[]): Promise<void> => {
  await Promise.all(
    files.map(async ({ filepath }) => {
      try {
        await fs.promises.unlink(filepath)
      } catch (error: unknown) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined
        if (code !== 'ENOENT') {
          console.error('[Media] Could not remove temporary upload', error)
        }
      }
    })
  )
}

export const handleUploadImage = (req: Request): Promise<ParsedMediaUpload> =>
  parseMediaUpload(req, {
    fieldName: 'image',
    mimePrefix: 'image/',
    uploadDir: UPLOAD_IMAGE_TEMP_DIR,
    maxFiles: 4,
    maxFileSizeMb: envConfig.media.maxImageUploadMb
  })

export const handleUploadVideo = (req: Request): Promise<ParsedMediaUpload> =>
  parseMediaUpload(req, {
    fieldName: 'video',
    mimePrefix: 'video/',
    uploadDir: UPLOAD_VIDEO_DIR,
    maxFiles: 1,
    maxFileSizeMb: envConfig.media.maxVideoUploadMb
  })

export const handleUploadAudio = (req: Request): Promise<ParsedMediaUpload> =>
  parseMediaUpload(req, {
    fieldName: 'audio',
    mimePrefix: 'audio/',
    uploadDir: UPLOAD_AUDIO_DIR,
    maxFiles: 1,
    maxFileSizeMb: envConfig.media.maxAudioUploadMb
  })
