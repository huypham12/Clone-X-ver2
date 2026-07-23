import { Queue, Worker } from 'bullmq'
import { connection } from '~/config/redisConfig'
import { uploadVideoToCloudinary } from '~/utils/cloudinary'
import DatabaseService from '~/config/database.service'
import { ObjectId } from 'mongodb'
import { MediaStatus } from '~/constants/enums'

const databaseService = new DatabaseService()

export const videoQueue = new Queue('videoUpload', { connection })

export const videoWorker = new Worker(
  'videoUpload',
  async (job) => {
    const { filepath, mediaId } = job.data
    console.log(`[Video Worker] Bắt đầu upload job ${job.id} cho media ${mediaId}`)

    try {
      // 1. Gọi hàm upload lên Cloudinary (hàm này đã tự động xóa file temp sau khi up)
      const uploadResult = await uploadVideoToCloudinary(filepath)

      // 2. Lấy thumbnailUrl (tương tự như cũ)
      const thumbnailUrl = uploadResult.secure_url.replace(/\.[^/.]+$/, '.jpg')

      // 3. Cập nhật Database
      await databaseService.medias.updateOne(
        { _id: new ObjectId(mediaId) },
        {
          $set: {
            url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            thumbnail: thumbnailUrl,
            status: MediaStatus.Ready,
            updated_at: new Date()
          }
        }
      )

      console.log(`[Video Worker] Job ${job.id} thành công!`)
    } catch (error) {
      console.error(`[Video Worker] Lỗi ở job ${job.id}:`, error)

      // Cập nhật trạng thái Failed
      await databaseService.medias.updateOne(
        { _id: new ObjectId(mediaId) },
        {
          $set: {
            status: MediaStatus.Failed,
            updated_at: new Date()
          }
        }
      )
      throw error // Ném lỗi ra để BullMQ ghi nhận fail
    }
  },
  { connection }
)

// Bắt sự kiện lỗi chung của worker
videoWorker.on('error', (err) => {
  console.error('[Video Worker] Uncaught Error:', err)
})
