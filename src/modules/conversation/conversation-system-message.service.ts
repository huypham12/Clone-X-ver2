import type { ClientSession, ObjectId } from 'mongodb'
import { ConversationSystemEventType } from '~/constants/enums'
import conversationMessageCommandService, {
  type ConversationMessageCommandService,
  type MessageCommandResult
} from './conversation-message-command.service'

export interface CreateConversationSystemMessageCommand {
  actor_id: ObjectId
  conversation_id: ObjectId
  system_event_type: ConversationSystemEventType
  affected_user_ids: ObjectId[]
  recipient_ids: ObjectId[]
  context?: Record<string, unknown>
  occurred_at: Date
}

const systemMessageContent: Record<ConversationSystemEventType, string> = {
  [ConversationSystemEventType.GroupCreated]: 'Group created',
  [ConversationSystemEventType.MemberAdded]: 'Member added to the group',
  [ConversationSystemEventType.MemberLeft]: 'Member left the group',
  [ConversationSystemEventType.MemberKicked]: 'Member removed from the group',
  [ConversationSystemEventType.AdminGranted]: 'Group admin granted',
  [ConversationSystemEventType.AdminRevoked]: 'Group admin revoked',
  [ConversationSystemEventType.AdminTransferredAndLeft]: 'Group admin transferred and previous admin left'
}

export class ConversationSystemMessageService {
  constructor(private readonly commandService: ConversationMessageCommandService = conversationMessageCommandService) {}

  createInTransaction(
    command: CreateConversationSystemMessageCommand,
    session: ClientSession
  ): Promise<MessageCommandResult> {
    return this.commandService.sendSystemInTransaction(
      {
        ...command,
        content: systemMessageContent[command.system_event_type],
        context: command.context ?? {}
      },
      session
    )
  }
}

const conversationSystemMessageService = new ConversationSystemMessageService()
export default conversationSystemMessageService
