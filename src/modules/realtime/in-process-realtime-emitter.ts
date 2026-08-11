import { getIO } from '~/socket/socket-server'
import type { RealtimeEmitter } from './realtime-emitter'

export class InProcessRealtimeEmitter implements RealtimeEmitter {
  emit(room: string, event: string, payload: unknown): void {
    getIO().to(room).emit(event, payload)
  }
}

export const inProcessRealtimeEmitter = new InProcessRealtimeEmitter()
