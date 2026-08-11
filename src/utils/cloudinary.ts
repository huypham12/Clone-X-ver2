import { v2 as cloudinary } from 'cloudinary'
import fs from 'fs'
import { envConfig } from '~/config/getEnvConfig'

cloudinary.config({
  cloud_name: envConfig.cloudinary.cloudName,
  api_key: envConfig.cloudinary.apiKey,
  api_secret: envConfig.cloudinary.apiSecret
})

export const uploadImageToCloudinary = async (filepath: string) => {
  try {
    return await cloudinary.uploader.upload(filepath, {
      folder: 'clone-x/images', // bạn có thể đổi tên folder tùy ý
      use_filename: true,
      unique_filename: true
    })
  } finally {
    // Luôn xóa file tạm để tránh đầy ổ cứng, kể cả khi upload lỗi.
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  }
}

export const uploadVideoToCloudinary = async (filepath: string) => {
  try {
    return await cloudinary.uploader.upload(filepath, {
      folder: 'clone-x/videos',
      resource_type: 'video',
      use_filename: true,
      unique_filename: true
      // Tự động tạo ảnh thumbnail tại giây thứ 0, lưu cùng public_id nhưng đuôi jpg
      // Hoặc ta có thể parse URL để lấy thumbnail sau.
    })
  } finally {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  }
}

export const uploadAudioToCloudinary = async (filepath: string) => {
  try {
    return await cloudinary.uploader.upload(filepath, {
      folder: 'clone-x/audios',
      resource_type: 'video', // Cloudinary uses 'video' for audio files as well
      use_filename: true,
      unique_filename: true
    })
  } finally {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  }
}

export const deleteFromCloudinary = async (public_id: string, resource_type: 'image' | 'video' | 'raw' = 'image') =>
  cloudinary.uploader.destroy(public_id, { resource_type })
