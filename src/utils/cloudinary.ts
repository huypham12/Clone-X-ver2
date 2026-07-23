import { v2 as cloudinary } from 'cloudinary'
import fs from 'fs'
import { config } from 'dotenv'

config() // Load env variables

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

export const uploadImageToCloudinary = async (filepath: string) => {
  try {
    const result = await cloudinary.uploader.upload(filepath, {
      folder: 'clone-x/images', // bạn có thể đổi tên folder tùy ý
      use_filename: true,
      unique_filename: true,
    })
    
    // Upload xong thì xóa file tạm ở server đi
    fs.unlinkSync(filepath)
    
    return result
  } catch (error) {
    // Kể cả lỗi cũng nên xóa file tạm để tránh đầy ổ cứng
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
    throw error
  }
}

export const uploadVideoToCloudinary = async (filepath: string) => {
  try {
    const result = await cloudinary.uploader.upload(filepath, {
      folder: 'clone-x/videos',
      resource_type: 'video',
      use_filename: true,
      unique_filename: true,
      // Tự động tạo ảnh thumbnail tại giây thứ 0, lưu cùng public_id nhưng đuôi jpg
      // Hoặc ta có thể parse URL để lấy thumbnail sau.
    })
    
    fs.unlinkSync(filepath)
    
    return result
  } catch (error) {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
    throw error
  }
}
