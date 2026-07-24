import { Server } from 'socket.io'
import { Server as HttpServer } from 'http'
import { verifyToken } from '~/utils/jwt'
import { envConfig } from '~/config/getEnvConfig'
import DatabaseService from '~/config/database.service'
import { TokenPayload } from '~/types/token-payload.type'
import { chatHandler } from './chat.handler'
import redisService from '~/config/redis.service'

// Mở rộng kiểu Socket để có thể gắn user_id vào
declare module 'socket.io' {
  interface Socket {
    user_id?: string
  }
}

let io: Server

export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: envConfig.cors.origin
    }
  })

  // Middleware xác thực token
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1]
      
      if (!token) {
        return next(new Error('Authentication error: Missing token'))
      }

      const decoded: TokenPayload = await verifyToken({
        token,
        secretKey: envConfig.secrets.jwt.access
      })
      
      socket.user_id = decoded.user_id
      next()
    } catch (error) {
      next(new Error('Authentication error: Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user_id} with socket_id: ${socket.id}`)

    // Join room với chính user_id để nhận notification direct
    socket.join(socket.user_id as string)

    // Truy vấn MongoDB lấy danh sách conversation_id mà user này tham gia và cho socket join
    const databaseService = new DatabaseService()
    const objectIdUserId = new databaseService.ObjectId(socket.user_id as string)

    // Lấy Direct Conversations
    databaseService.directConversations.find({
      $or: [{ user1_id: objectIdUserId }, { user2_id: objectIdUserId }]
    }).toArray().then(directs => {
      directs.forEach(conv => {
        socket.join(conv._id?.toString() as string)
      })
    })

    // Lấy Group Conversations
    databaseService.groupConversations.find({
      'members.user_id': objectIdUserId
    }).toArray().then(groups => {
      groups.forEach(conv => {
        socket.join(conv._id?.toString() as string)
      })
    })

    // Lưu socket_id vào Redis để track Online Status
    redisService.clientInstance.sAdd(`user_sockets:${socket.user_id}`, socket.id).then(async () => {
      // Broadcast online status to friends/followers could be done here
      // io.emit('user_online', { user_id: socket.user_id })
    })

    // Handle chat events
    chatHandler(io, socket)

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.user_id}`)
      
      // Xóa socket_id khỏi Redis
      await redisService.clientInstance.sRem(`user_sockets:${socket.user_id}`, socket.id)
      
      // Kiểm tra xem user còn thiết bị nào online không
      const activeSockets = await redisService.clientInstance.sCard(`user_sockets:${socket.user_id}`)
      if (activeSockets === 0) {
        // Cập nhật last seen nếu cần
        await redisService.clientInstance.hSet('user_last_seen', socket.user_id as string, Date.now().toString())
        // Broadcast offline status
        // io.emit('user_offline', { user_id: socket.user_id })
      }
    })
  })

  return io
}

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io is not initialized')
  }
  return io
}
