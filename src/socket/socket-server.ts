import type { Server } from 'socket.io'

let socketServer: Server | undefined

export const setIO = (io: Server): void => {
  socketServer = io
}

export const getIO = (): Server => {
  if (!socketServer) throw new Error('Socket.io is not initialized')
  return socketServer
}
