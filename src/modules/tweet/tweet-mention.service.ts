import { ObjectId, type ClientSession } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { UserVerifyStatus } from '~/constants/enums'
import { UserMentionCandidateService } from '~/modules/user/user-mention-candidate.service'

export type MentionIdInput = string | ObjectId

const MAX_TWEET_MENTIONS = 20

export class TweetMentionService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly candidateService: UserMentionCandidateService = new UserMentionCandidateService(databaseService)
  ) {}

  async resolve(
    content: string,
    explicitMentionIds: MentionIdInput[],
    actorId: ObjectId,
    session?: ClientSession,
    contextTweetId?: ObjectId | null
  ): Promise<ObjectId[]> {
    const explicitIds = new Map<string, ObjectId>()
    for (const input of explicitMentionIds.slice(0, MAX_TWEET_MENTIONS)) {
      const normalized = input instanceof ObjectId ? input : ObjectId.isValid(input) ? new ObjectId(input) : null
      if (normalized && !normalized.equals(actorId)) explicitIds.set(normalized.toHexString(), normalized)
    }

    const usernames = new Set<string>()
    for (const match of content.matchAll(/@([A-Za-z0-9_]+)/g)) {
      if (match[1]) usernames.add(match[1])
      if (usernames.size >= MAX_TWEET_MENTIONS) break
    }
    if (explicitIds.size === 0 && usernames.size === 0) return []
    const filters: Array<Record<string, unknown>> = []
    if (explicitIds.size > 0) filters.push({ _id: { $in: [...explicitIds.values()] } })
    if (usernames.size > 0) filters.push({ username: { $in: [...usernames] } })
    const users = await this.databaseService.users
      .find(
        {
          $and: [
            filters.length === 1 ? filters[0] : { $or: filters },
            { verify: { $ne: UserVerifyStatus.Banned } }
          ]
        },
        { projection: { _id: 1 }, session }
      )
      .toArray()
    const eligibleIds = await this.candidateService.filterEligibleUserIds(
      actorId,
      users.map((user) => user._id),
      contextTweetId,
      session
    )
    const mentions = new Map<string, ObjectId>()
    for (const user of users) {
      const key = user._id.toHexString()
      if (eligibleIds.has(key)) mentions.set(key, user._id)
    }

    return [...mentions.values()]
  }
}
