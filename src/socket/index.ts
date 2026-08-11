import { Server } from 'socket.io'
import { Server as HttpServer } from 'http'
import { verifyToken } from '~/utils/jwt'
import { envConfig, isCorsOriginAllowed } from '~/config/getEnvConfig'
import { TokenPayload } from '~/types/token-payload.type'
import { chatHandler } from './chat.handler'
import redisService from '~/config/redis.service'
import { createAdapter } from '@socket.io/redis-adapter'
import { UserService } from '~/modules/user/user.service'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { setIO } from './socket-server'

// Mở rộng kiểu Socket để có thể gắn user_id vào
declare module 'socket.io' {
  interface Socket {
    user_id?: string
  }
}

let io: Server

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

export const initSocket = (httpServer: HttpServer, databaseService: DatabaseService = sharedDatabaseService) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
      credentials: true
    }
  })
  setIO(io)

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

  const userService = new UserService(databaseService)

  const getFriendIds = async (userId: string): Promise<string[]> => {
    const cachedFriends = await redisService.get(`friends:${userId}`)
    if (isStringArray(cachedFriends)) return cachedFriends

    const friends = await userService.getFriends(userId)
    const friendIds = friends
      .map((friend) => friend._id?.toString())
      .filter((friendId): friendId is string => friendId !== undefined)
    await redisService.set(`friends:${userId}`, friendIds, 300)
    return friendIds
  }

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user_id} with socket_id: ${socket.id}`)

    const userId = socket.user_id
    if (!userId) {
      socket.disconnect(true)
      return
    }

    // Chỉ join đúng 1 room duy nhất là ID của user
    socket.join(userId)

    // Xử lý các sự kiện chat
    chatHandler(io, socket)

    // API lấy trạng thái Online từ Frontend
    socket.on('get:presence', async (userIds: string[], callback) => {
      try {
        if (!Array.isArray(userIds) || userIds.length === 0) {
          if (callback) callback([])
          return
        }

        const presenceList = await Promise.all(
          userIds.map(async (id) => {
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
          })
        )

        if (callback) callback(presenceList)
      } catch (error) {
        console.error('Error getting presence:', error)
        if (callback) callback([])
      }
    })

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user_id}`)

      // Delay một chút để socket thực sự rời khỏi room trước khi fetchSockets
      setTimeout(() => {
        void (async () => {
          const remainingSockets = await io.in(userId).allSockets()

          // Nếu user đã ngắt kết nối hoàn toàn trên TẤT CẢ thiết bị
          if (remainingSockets.size === 0) {
            const lastSeenAt = new Date().toISOString()
            await redisService.clientInstance.hSet('user_last_seen', userId, lastSeenAt)

            // Phát sự kiện offline cho Bạn Bè
            const friendIds = await getFriendIds(userId)

            if (friendIds.length > 0) {
              io.to(friendIds).emit('user:offline', { user_id: userId, lastSeenAt })
            }
          }
        })().catch((error: unknown) => {
          console.error('Could not update disconnected user presence:', error)
        })
      }, 500)
    })

    void (async () => {
      const friendIds = await getFriendIds(userId)
      const userSockets = await io.in(userId).allSockets()
      if (userSockets.size === 1 && friendIds.length > 0) {
        io.to(friendIds).emit('user:online', { user_id: userId })
      }
    })().catch((error: unknown) => {
      console.error('Could not initialize connected user presence:', error)
    })
  })

  return io
}

export { getIO } from './socket-server'
