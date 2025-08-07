import express from 'express'
import DatabaseService from './config/database.service'
import { envConfig } from './config/getEnvConfig'
import { authRouter, userRouter } from './modules'
import { errorHandler } from './middleware/error-handler.middleware'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yaml'
import fs from 'fs'

const main = async () => {
  const app = express()
  const PORT = envConfig.app.port || 3000
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100, // giới hạn 100 request / IP / 15 phút
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

    app.use(limiter)
    app.use(helmet())
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.use('/api/user', userRouter)
    app.use(errorHandler)

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions, swaggerUiOptions))

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Error connecting to the database:', error)
    process.exit(1) // thoát app, không chạy nữa
  }
}

main()
