import express from 'express'
import { createServer } from 'http'
import { initSocket } from './socket'
import { databaseService } from './config/database.service'
import { envConfig, isCorsOriginAllowed, isProduction } from './config/getEnvConfig'
import redisService from './config/redis.service'
import { startVideoWorker, videoQueue, videoWorker } from '~/queues/video.queue'
import { notificationQueue } from '~/queues/notification.queue'
import { connectBullMqRedis, disconnectBullMqRedis } from '~/config/redisConfig'
import { OutboxQueuePublisher } from '~/modules/events/outbox.publisher'
import { NotificationWorker } from '~/modules/notification/notification.worker'
import { NotificationFanoutWorker } from '~/modules/notification/notification-fanout.worker'
import { notificationFanoutQueue } from '~/queues/notification-fanout.queue'
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
import healthRouter from './modules/health/health.route'
import { HttpError } from './common/http-error'
import { HTTP_STATUS } from './constants/httpStatus'

// Khởi tạo các thư mục upload
initFolder()

const main = async () => {
  const app = express()
  const port = envConfig.app.port
  app.set('trust proxy', envConfig.app.trustProxyHops)
  let httpServer: ReturnType<typeof createServer> | undefined
  let outboxPublisher: OutboxQueuePublisher | undefined
  let notificationWorker: NotificationWorker | undefined
  let notificationFanoutWorker: NotificationFanoutWorker | undefined
  let shuttingDown = false

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Shutting down server: ${reason}`)

    await outboxPublisher?.stop().catch((error: unknown) => {
      console.error('Could not stop notification outbox publisher', error)
    })
    if (httpServer?.listening) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()))
    }
    await notificationWorker?.close().catch((error: unknown) => {
      console.error('Could not stop notification worker', error)
    })
    await notificationFanoutWorker?.close().catch((error: unknown) => {
      console.error('Could not stop notification fanout worker', error)
    })
    await Promise.allSettled([
      notificationQueue.close(),
      notificationFanoutQueue.close(),
      videoWorker.close(false),
      videoQueue.close()
    ])
    await disconnectBullMqRedis().catch(() => undefined)
    await redisService.disconnect().catch(() => undefined)
    await databaseService.disconnect().catch(() => undefined)
    process.exitCode = exitCode
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
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

  const listen = (server: ReturnType<typeof createServer>): Promise<void> =>
    new Promise((resolve, reject) => {
      const handleError = (error: Error) => {
        server.off('listening', handleListening)
        reject(error)
      }
      const handleListening = () => {
        server.off('error', handleError)
        resolve()
      }
      server.once('error', handleError)
      server.once('listening', handleListening)
      server.listen(port)
    })

  try {
    await databaseService.connect()
    console.log('Database connected successfully')

    await databaseService.createIndexes()
    console.log('Database indexes are ready')

    await redisService.connect()
    await connectBullMqRedis()
    console.log('Redis dependencies are ready')

    // CORS và security headers áp dụng cho probe, nhưng probe không đi qua global limiter.
    app.use(
      cors({
        origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
        credentials: true
      })
    )
    app.use(helmet())
    app.use('/health', healthRouter)
    app.use(express.json())
    app.use(limiter)
    app.use('/api/auth', authRouter)
    app.use('/api/user', userRouter)
    app.use('/api/media', mediaRouter)
    app.use('/api/tweets', tweetRouter)
    app.use('/api/conversations', conversationRouter)
    app.use('/api/search', searchRouter)
    app.use('/api/notifications', notificationRouter)

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions, swaggerUiOptions))
    app.use((_req, _res, next) => next(new HttpError('Route not found', HTTP_STATUS.NOT_FOUND)))
    app.use(errorHandler)

    httpServer = createServer(app)

    initSocket(httpServer, databaseService)
    await startVideoWorker()

    if (envConfig.features.notificationOutboxEnabled) {
      notificationWorker = new NotificationWorker(databaseService)
      await notificationWorker.waitUntilReady()
      if (envConfig.features.notificationFollowedTweetEnabled) {
        notificationFanoutWorker = new NotificationFanoutWorker(databaseService)
        await notificationFanoutWorker.waitUntilReady()
      }
      outboxPublisher = new OutboxQueuePublisher()
      outboxPublisher.start()
      console.log('Notification outbox publisher and worker are enabled')
    } else {
      console.log('Notification outbox publisher and worker are disabled')
    }

    await listen(httpServer)
    httpServer.on('error', (error: Error) => {
      console.error('HTTP server error', error)
      void shutdown('http_server_error', 1)
    })
    console.log(`Server is running on http://localhost:${port}`)
  } catch (error) {
    console.error('Server startup failed:', error)
    await shutdown('startup_error', 1)
  }
}

void main()
