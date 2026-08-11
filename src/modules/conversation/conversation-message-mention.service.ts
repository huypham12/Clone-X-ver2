import type { ClientSession, ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { UserVerifyStatus } from '~/constants/enums'

const USERNAME_MENTION_PATTERN = /@([A-Za-z0-9_]{4,15})\b/g

export class ConversationMessageMentionService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async resolve(
    content: string,
    explicitUserIds: string[],
    senderId: ObjectId,
    memberIds: string[],
    session: ClientSession
  ): Promise<ObjectId[]> {
    const groupMembers = new Map<string, ObjectId>()
    for (const memberId of memberIds) {
      const id = new this.databaseService.ObjectId(memberId)
      if (!id.equals(senderId)) groupMembers.set(id.toHexString(), id)
    }

    const groupMemberIds = [...groupMembers.values()]
    if (groupMemberIds.length === 0) return []
    const [availableUsers, blocks] = await Promise.all([
      this.databaseService.users
        .find(
          { _id: { $in: groupMemberIds }, verify: { $ne: UserVerifyStatus.Banned } },
          { projection: { _id: 1, username: 1 }, session }
        )
        .toArray(),
      this.databaseService.userBlocks
        .find(
          {
            $or: [
              { user_id: senderId, blocked_user_id: { $in: groupMemberIds } },
              { user_id: { $in: groupMemberIds }, blocked_user_id: senderId }
            ]
          },
          { projection: { user_id: 1, blocked_user_id: 1 }, session }
        )
        .toArray()
    ])
    const blockedIds = new Set(
      blocks.map((block) =>
        block.user_id.equals(senderId) ? block.blocked_user_id.toHexString() : block.user_id.toHexString()
      )
    )
    const availableMembers = new Map(
      availableUsers
        .filter((user) => !blockedIds.has(user._id.toHexString()))
        .map((user) => [user._id.toHexString(), user] as const)
    )

    const resolved = new Map<string, ObjectId>()
    for (const explicitId of explicitUserIds) {
      const key = new this.databaseService.ObjectId(explicitId).toHexString()
      const member = availableMembers.get(key)
      if (member) resolved.set(key, member._id)
    }

    const usernames = new Set<string>()
    for (const match of content.matchAll(USERNAME_MENTION_PATTERN)) {
      if (match[1]) usernames.add(match[1])
    }
    if (usernames.size === 0) return [...resolved.values()]
    for (const user of availableMembers.values()) {
      if (user.username && usernames.has(user.username)) resolved.set(user._id.toHexString(), user._id)
    }
    return [...resolved.values()]
  }
}

const conversationMessageMentionService = new ConversationMessageMentionService()
export default conversationMessageMentionService
