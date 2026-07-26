import { Server } from 'socket.io'
import { Server as HttpServer } from 'http'
import { verifyToken } from '~/utils/jwt'
import { envConfig } from '~/config/getEnvConfig'
import { TokenPayload } from '~/types/token-payload.type'
import { chatHandler } from './chat.handler'
import redisService from '~/config/redis.service'
import { createAdapter } from '@socket.io/redis-adapter'
import { UserService } from '~/modules/user/user.service'
import DatabaseService from '~/config/database.service'

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
      origin: true,
      credentials: true
    }
  })

  // Tích hợp Redis Adapter cho Horizontal Scaling
  if (redisService.pubClient && redisService.subClient) {
    io.adapter(createAdapter(redisService.pubClient, redisService.subClient))
    console.log('Redis Adapter cho Socket.io đã được khởi tạo')
  }

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

  const databaseService = new DatabaseService()
  const userService = new UserService(databaseService)

  io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.user_id} with socket_id: ${socket.id}`)
    
    const userId = socket.user_id as string

    // Chỉ join đúng 1 room duy nhất là ID của user
    socket.join(userId)

    // Lấy danh sách bạn bè (từ Redis Cache hoặc Database)
    let friendIds: string[] = []
    const cachedFriends = await redisService.get(`friends:${userId}`)
    if (cachedFriends) {
      friendIds = cachedFriends
    } else {
      const friends = await userService.getFriends(userId)
      friendIds = friends.map(f => f._id?.toString() as string)
      await redisService.set(`friends:${userId}`, friendIds, 300) // Cache 5 phút
    }

    // Kiểm tra xem đây có phải là thiết bị ĐẦU TIÊN của user kết nối không (bằng Redis Adapter)
    const userSockets = await io.in(userId).allSockets()
    if (userSockets.size === 1 && friendIds.length > 0) {
      // Chỉ gửi trạng thái Online cho Bạn Bè
      io.to(friendIds).emit('user:online', { user_id: userId })
    }

    // Xử lý các sự kiện chat
    chatHandler(io, socket)

    // API lấy trạng thái Online từ Frontend
    socket.on('get:presence', async (userIds: string[], callback) => {
      try {
        if (!Array.isArray(userIds) || userIds.length === 0) {
          if (callback) callback([])
          return
        }
        
        const presenceList = await Promise.all(userIds.map(async (id) => {
          // Lấy tất cả socket id của user đó trên TOÀN BỘ cluster qua Redis Adapter
          const sockets = await io.in(id).allSockets()
          const isOnline = sockets.size > 0
          let lastSeenAt = null
          
          if (!isOnline) {
            lastSeenAt = await redisService.clientInstance.hGet('user_last_seen', id)
          }
          
          return {
            user_id: id,
            isOnline,
            lastSeenAt
          }
        }))
        
        if (callback) callback(presenceList)
      } catch (error) {
        console.error('Error getting presence:', error)
        if (callback) callback([])
      }
    })

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.user_id}`)
      
      // Delay một chút để socket thực sự rời khỏi room trước khi fetchSockets
      setTimeout(async () => {
        const remainingSockets = await io.in(userId).allSockets()
        
        // Nếu user đã ngắt kết nối hoàn toàn trên TẤT CẢ thiết bị
        if (remainingSockets.size === 0) {
          const lastSeenAt = new Date().toISOString()
          await redisService.clientInstance.hSet('user_last_seen', userId, lastSeenAt)
          
          // Phát sự kiện offline cho Bạn Bè
          let fIds: string[] = []
          const cFriends = await redisService.get(`friends:${userId}`)
          if (cFriends) {
            fIds = cFriends
          } else {
            const friends = await userService.getFriends(userId)
            fIds = friends.map(f => f._id?.toString() as string)
            await redisService.set(`friends:${userId}`, fIds, 300)
          }
          
          if (fIds.length > 0) {
            io.to(fIds).emit('user:offline', { user_id: userId, lastSeenAt })
          }
        }
      }, 500)
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
