// main.ts hoặc index.ts
import express from 'express'
import DatabaseService from './config/database.service'
import { getEnvConfig } from './config/getEnvConfig'
import { authRouter } from './modules'

const main = async () => {
  getEnvConfig()
  const app = express()
  const PORT = process.env.PORT || 3000

  const databaseService = new DatabaseService()

  try {
    await databaseService.connect()
    console.log('Database connected successfully')

    // Sau khi kết nối DB xong thì mới khởi động app
    app.use(express.json())
    app.use('/auth', authRouter)

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Error connecting to the database:', error)
    process.exit(1) // thoát app, không chạy nữa
  }
}

main()
