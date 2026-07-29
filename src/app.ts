import express from 'express'
import { createServer } from 'http'
import { initSocket } from './socket'
import DatabaseService from './config/database.service'
import { envConfig, isProduction } from './config/getEnvConfig'
import redisService from './config/redis.service'
import '~/queues/video.queue' // Khởi động video worker
import {
  authRouter,
  userRouter,
  mediaRouter,
  tweetRouter,
  conversationRouter,
  searchRouter,
  notificationRouter
} from './modules'
import { errorHandler } from './middleware/error-handler.middleware'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yaml'
import fs from 'fs'
import { initFolder } from './utils/file'

// Khởi tạo các thư mục upload
initFolder()

const main = async () => {
  const app = express()
  const PORT = envConfig.app.port || 3000
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    // Một trang có thể gọi nhiều endpoint song song khi phát triển. Giữ giới hạn
    // chặt trên production nhưng tránh khóa nhầm localhost trong lúc hot reload.
    max: isProduction ? 100 : 10_000,
    message: 'Bạn đã gửi quá nhiều request. Vui lòng thử lại sau 15 phút.',
    standardHeaders: true, // gửi các header rate limit (RateLimit-*)
    legacyHeaders: false // bỏ x-RateLimit-*
  })

  // Load Swagger documentation
  const swaggerDocument = YAML.parse(fs.readFileSync('./swagger.yaml', 'utf8'))
  const swaggerOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'X API Documentation',
    explorer: true
  }
  const swaggerUiOptions = {
    explorer: true,
    swaggerOptions: {
      docExpansion: 'none',
      defaultModelsExpandDepth: -1
    }
  }

  const databaseService = new DatabaseService()

  try {
    await databaseService.connect()
    console.log('Database connected successfully')

    await databaseService.createConversationIndexes()
    console.log('Conversation indexes are ready')

    await redisService.connect()

    // CORS phải chạy trước rate limiter để cả phản hồi 429 cũng có CORS headers.
    app.use(cors({ origin: true, credentials: true })) // Cho phép origin hiện tại và gửi kèm cookie
    app.use(limiter)
    app.use(helmet())
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.use('/api/user', userRouter)
    app.use('/api/media', mediaRouter)
    app.use('/api/tweets', tweetRouter)
    app.use('/api/conversations', conversationRouter)
    app.use('/api/search', searchRouter)
    app.use('/api/notifications', notificationRouter)
    app.use(errorHandler)

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions, swaggerUiOptions))

    const httpServer = createServer(app)

    initSocket(httpServer)

    httpServer.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Error connecting to the database:', error)
    process.exit(1) // thoát app, không chạy nữa
  }
}

main()
