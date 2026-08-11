import { Request } from 'express'
import formidable, { File } from 'formidable'
import fs from 'fs'
import path from 'path'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'

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

export const handleUploadImage = async (req: Request) => {
  const form = formidable({
    uploadDir: UPLOAD_IMAGE_TEMP_DIR,
    maxFiles: 4,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxTotalFileSize: 50 * 1024 * 1024 * 4,
    filter: function ({ name, originalFilename, mimetype }) {
      const valid = name === 'image' && Boolean(mimetype?.includes('image/'))
      if (!valid) {
        form.emit('error' as any, new Error('File type is not valid') as any)
      }
      return valid
    }
  })

  return new Promise<File[]>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        return reject(new HttpError(err.message, HTTP_STATUS.BAD_REQUEST))
      }
      // files.image is an array of files in formidable v3
      if (!files.image) {
        return reject(new HttpError('File is empty', HTTP_STATUS.BAD_REQUEST))
      }
      
      resolve(files.image as File[])
    })
  })
}

export const handleUploadVideo = async (req: Request) => {
  const form = formidable({
    uploadDir: UPLOAD_VIDEO_DIR,
    maxFiles: 1, // Nên cho upload 1 video mỗi lần để tránh quá tải
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    filter: function ({ name, originalFilename, mimetype }) {
      const valid = name === 'video' && Boolean(mimetype?.includes('video/'))
      if (!valid) {
        form.emit('error' as any, new Error('File type is not valid') as any)
      }
      return valid
    }
  })

  return new Promise<File[]>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        return reject(new HttpError(err.message, HTTP_STATUS.BAD_REQUEST))
      }
      if (!files.video) {
        return reject(new HttpError('File is empty', HTTP_STATUS.BAD_REQUEST))
      }
      
      resolve(files.video as File[])
    })
  })
}

export const handleUploadAudio = async (req: Request) => {
  const form = formidable({
    uploadDir: UPLOAD_AUDIO_DIR,
    maxFiles: 1,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    filter: function ({ name, originalFilename, mimetype }) {
      const valid = name === 'audio' && Boolean(mimetype?.includes('audio/'))
      if (!valid) {
        form.emit('error' as any, new Error('File type is not valid') as any)
      }
      return valid
    }
  })

  return new Promise<File[]>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) {
        return reject(new HttpError(err.message, HTTP_STATUS.BAD_REQUEST))
      }
      if (!files.audio) {
        return reject(new HttpError('File is empty', HTTP_STATUS.BAD_REQUEST))
      }
      
      resolve(files.audio as File[])
    })
  })
}
