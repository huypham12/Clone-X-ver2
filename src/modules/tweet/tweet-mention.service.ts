import { ObjectId, type ClientSession } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'

export type MentionIdInput = string | ObjectId

export class TweetMentionService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async resolve(
    content: string,
    explicitMentionIds: MentionIdInput[],
    actorId: ObjectId,
    session?: ClientSession
  ): Promise<ObjectId[]> {
    const explicitIds = new Map<string, ObjectId>()
    for (const input of explicitMentionIds) {
      const normalized = input instanceof ObjectId ? input : ObjectId.isValid(input) ? new ObjectId(input) : null
      if (normalized && !normalized.equals(actorId)) explicitIds.set(normalized.toHexString(), normalized)
    }

    const usernames = new Set<string>()
    for (const match of content.matchAll(/@([A-Za-z0-9_]+)/g)) {
      if (match[1]) usernames.add(match[1])
    }
    if (explicitIds.size === 0 && usernames.size === 0) return []
    const filters: Array<Record<string, unknown>> = []
    if (explicitIds.size > 0) filters.push({ _id: { $in: [...explicitIds.values()] } })
    if (usernames.size > 0) filters.push({ username: { $in: [...usernames] } })
    const users = await this.databaseService.users
      .find(filters.length === 1 ? filters[0] : { $or: filters }, { projection: { _id: 1 }, session })
      .toArray()
    const mentions = new Map<string, ObjectId>()
    for (const user of users) {
      if (!user._id.equals(actorId)) mentions.set(user._id.toHexString(), user._id)
    }

    return [...mentions.values()]
  }
}
