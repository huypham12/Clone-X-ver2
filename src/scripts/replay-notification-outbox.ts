import { databaseService } from '~/config/database.service'
import { connection } from '~/config/redisConfig'
import { OutboxQueuePublisher } from '~/modules/events/outbox.publisher'
import { notificationQueue } from '~/queues/notification.queue'

const eventId = process.argv[2]

const main = async (): Promise<void> => {
  if (!eventId) throw new Error('Usage: npm run notification:outbox:replay -- <event_id>')
  try {
    await databaseService.connect()
    await databaseService.createOutboxIndexes()
    const publisher = new OutboxQueuePublisher()
    const replayed = await publisher.replay(eventId)
    if (!replayed) throw new Error(`Dead-letter outbox event not found: ${eventId}`)
    console.log(`Notification outbox event scheduled for replay: ${eventId}`)
  } finally {
    await notificationQueue.close().catch(() => undefined)
    await connection.quit().catch(() => undefined)
    await databaseService.disconnect().catch(() => undefined)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
