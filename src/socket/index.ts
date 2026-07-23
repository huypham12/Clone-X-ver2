import { Server } from 'socket.io'
import { Server as HttpServer } from 'http'
import { verifyToken } from '~/utils/jwt'
import { envConfig } from '~/config/getEnvConfig'
import DatabaseService from '~/config/database.service'
import { TokenPayload } from '~/types/token-payload.type'
import { chatHandler } from './chat.handler'

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
    
    // Handle chat events
    chatHandler(io, socket)

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user_id}`)
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
