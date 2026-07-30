import { databaseService } from '~/config/database.service'
import conversationReadService from '~/modules/conversation/conversation-read.service'

const userId = process.argv[2]

const main = async (): Promise<void> => {
  if (!userId || !databaseService.ObjectId.isValid(userId)) {
    throw new Error('Usage: npm run conversation:read-state:reconcile -- <user_id>')
  }
  try {
    await databaseService.connect()
    await databaseService.createConversationIndexes()
    const summary = await conversationReadService.reconcileSummary(userId)
    console.log({
      user_id: summary.user_id.toHexString(),
      unread_conversation_count: summary.unread_conversation_count,
      total_unread_message_count: summary.total_unread_message_count,
      version: summary.version,
      updated_at: summary.updated_at.toISOString()
    })
  } finally {
    await databaseService.disconnect().catch(() => undefined)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
