export interface RealtimeEmitter {
  emit(room: string, event: string, payload: unknown): void
}
