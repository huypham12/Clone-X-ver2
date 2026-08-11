import { v2 as cloudinary } from 'cloudinary'
import { envConfig } from '~/config/getEnvConfig'

cloudinary.config({
  cloud_name: envConfig.cloudinary.cloudName,
  api_key: envConfig.cloudinary.apiKey,
  api_secret: envConfig.cloudinary.apiSecret
})

export const uploadImageToCloudinary = async (filepath: string) => {
  return cloudinary.uploader.upload(filepath, {
    folder: 'clone-x/images',
    use_filename: true,
    unique_filename: true
  })
}

export const uploadVideoToCloudinary = async (filepath: string) => {
  return cloudinary.uploader.upload(filepath, {
    folder: 'clone-x/videos',
    resource_type: 'video',
    use_filename: true,
    unique_filename: true
  })
}

export const uploadAudioToCloudinary = async (filepath: string) => {
  return cloudinary.uploader.upload(filepath, {
    folder: 'clone-x/audios',
    resource_type: 'video',
    use_filename: true,
    unique_filename: true
  })
}

export const deleteFromCloudinary = async (public_id: string, resource_type: 'image' | 'video' | 'raw' = 'image') =>
  cloudinary.uploader.destroy(public_id, { resource_type })
