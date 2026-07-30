import type { ClientSession, ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'

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
    const eligibleMembers = new Map<string, ObjectId>()
    for (const memberId of memberIds) {
      const id = new this.databaseService.ObjectId(memberId)
      if (!id.equals(senderId)) eligibleMembers.set(id.toHexString(), id)
    }

    const resolved = new Map<string, ObjectId>()
    for (const explicitId of explicitUserIds) {
      const member = eligibleMembers.get(new this.databaseService.ObjectId(explicitId).toHexString())
      if (member) resolved.set(member.toHexString(), member)
    }

    const usernames = new Set<string>()
    for (const match of content.matchAll(USERNAME_MENTION_PATTERN)) {
      if (match[1]) usernames.add(match[1])
    }
    if (usernames.size === 0 || eligibleMembers.size === 0) return [...resolved.values()]

    const users = await this.databaseService.users
      .find(
        {
          _id: { $in: [...eligibleMembers.values()] },
          username: { $in: [...usernames] }
        },
        { projection: { _id: 1 }, session }
      )
      .toArray()
    for (const user of users) resolved.set(user._id.toHexString(), user._id)
    return [...resolved.values()]
  }
}

const conversationMessageMentionService = new ConversationMessageMentionService()
export default conversationMessageMentionService
