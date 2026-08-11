import { ObjectId, type ClientSession, type Filter } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { TweetAudience, UserVerifyStatus } from '~/constants/enums'
import type { User } from '~/schemas'

export type MentionCandidateSource = 'following' | 'follower' | 'interaction'

export interface MentionCandidate {
  _id: ObjectId
  name: string
  username: string
  avatar?: string
  source: MentionCandidateSource
}

interface MentionCandidateOptions {
  q?: string
  contextTweetId?: ObjectId
  limit?: number
}

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20
const OVERSAMPLE_FACTOR = 3

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class UserMentionCandidateService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async getCandidates(actorId: ObjectId, options: MentionCandidateOptions = {}): Promise<MentionCandidate[]> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const fetchLimit = limit * OVERSAMPLE_FACTOR
    const query = options.q?.trim() ?? ''
    const queryRegex = query ? new RegExp(escapeRegex(query), 'i') : undefined
    const contextTweet = options.contextTweetId
      ? await this.databaseService.tweets.findOne(
          { _id: options.contextTweetId },
          { projection: { user_id: 1, audience: 1 } }
        )
      : null
    const canUseContext = Boolean(
      contextTweet && (contextTweet.audience === TweetAudience.Everyone || contextTweet.user_id.equals(actorId))
    )

    const [following, followers, contextAuthor, likers, participants] = await Promise.all([
      this.getRelationCandidates(actorId, 'following', queryRegex, fetchLimit),
      this.getRelationCandidates(actorId, 'follower', queryRegex, fetchLimit),
      canUseContext && contextTweet
        ? this.getUsersByIds([contextTweet.user_id], actorId, 'interaction', queryRegex, fetchLimit)
        : Promise.resolve([]),
      canUseContext && options.contextTweetId
        ? this.getInteractionCandidates('likes', options.contextTweetId, actorId, queryRegex, fetchLimit)
        : Promise.resolve([]),
      canUseContext && options.contextTweetId
        ? this.getInteractionCandidates('tweets', options.contextTweetId, actorId, queryRegex, fetchLimit)
        : Promise.resolve([])
    ])

    const merged = new Map<string, MentionCandidate>()
    for (const candidate of [...following, ...followers, ...contextAuthor, ...likers, ...participants]) {
      const key = candidate._id.toHexString()
      if (!merged.has(key)) merged.set(key, candidate)
    }

    const candidates = [...merged.values()]
    const blockedIds = await this.getBlockedCandidateIds(
      actorId,
      candidates.map((candidate) => candidate._id)
    )
    return candidates.filter((candidate) => !blockedIds.has(candidate._id.toHexString())).slice(0, limit)
  }

  async filterEligibleUserIds(
    actorId: ObjectId,
    candidateIds: ObjectId[],
    contextTweetId?: ObjectId | null,
    session?: ClientSession
  ): Promise<Set<string>> {
    const uniqueIds = new Map<string, ObjectId>()
    for (const candidateId of candidateIds) {
      if (!candidateId.equals(actorId)) uniqueIds.set(candidateId.toHexString(), candidateId)
    }
    const ids = [...uniqueIds.values()]
    if (ids.length === 0) return new Set()

    const relationFilter = {
      $or: [
        { follow_user_id: actorId, followed_user_id: { $in: ids } },
        { follow_user_id: { $in: ids }, followed_user_id: actorId }
      ]
    }
    const [relations, blockedIds] = await Promise.all([
      this.databaseService.followers
        .find(relationFilter, { projection: { follow_user_id: 1, followed_user_id: 1 }, session })
        .toArray(),
      this.getBlockedCandidateIds(actorId, ids, session)
    ])

    const eligible = new Set<string>()
    for (const relation of relations) {
      const candidateId = relation.follow_user_id.equals(actorId) ? relation.followed_user_id : relation.follow_user_id
      eligible.add(candidateId.toHexString())
    }

    if (contextTweetId) {
      const contextTweet = await this.databaseService.tweets.findOne(
        { _id: contextTweetId },
        { projection: { user_id: 1, audience: 1 }, session }
      )
      const canUseContext = Boolean(
        contextTweet && (contextTweet.audience === TweetAudience.Everyone || contextTweet.user_id.equals(actorId))
      )
      if (canUseContext && contextTweet) {
        if (uniqueIds.has(contextTweet.user_id.toHexString())) eligible.add(contextTweet.user_id.toHexString())
        const [likes, childTweets] = await Promise.all([
          this.databaseService.likes
            .find({ tweet_id: contextTweetId, user_id: { $in: ids } }, { projection: { user_id: 1 }, session })
            .toArray(),
          this.databaseService.tweets
            .find({ parent_id: contextTweetId, user_id: { $in: ids } }, { projection: { user_id: 1 }, session })
            .toArray()
        ])
        for (const like of likes) eligible.add(like.user_id.toHexString())
        for (const tweet of childTweets) eligible.add(tweet.user_id.toHexString())
      }
    }

    for (const blockedId of blockedIds) eligible.delete(blockedId)
    return eligible
  }

  private async getRelationCandidates(
    actorId: ObjectId,
    source: 'following' | 'follower',
    queryRegex: RegExp | undefined,
    limit: number
  ): Promise<MentionCandidate[]> {
    const isFollowing = source === 'following'
    const userIdField = isFollowing ? 'followed_user_id' : 'follow_user_id'
    const userMatch = this.createAvailableUserMatch(actorId, queryRegex)
    return this.databaseService.followers
      .aggregate<MentionCandidate>([
        { $match: isFollowing ? { follow_user_id: actorId } : { followed_user_id: actorId } },
        { $sort: { updated_at: -1, _id: -1 } },
        {
          $lookup: {
            from: this.databaseService.users.collectionName,
            localField: userIdField,
            foreignField: '_id',
            as: 'candidate'
          }
        },
        { $unwind: '$candidate' },
        { $replaceRoot: { newRoot: '$candidate' } },
        { $match: userMatch },
        {
          $project: {
            _id: 1,
            name: 1,
            username: 1,
            avatar: 1,
            source: { $literal: source }
          }
        },
        { $limit: limit }
      ])
      .toArray()
  }

  private async getInteractionCandidates(
    collection: 'likes' | 'tweets',
    contextTweetId: ObjectId,
    actorId: ObjectId,
    queryRegex: RegExp | undefined,
    limit: number
  ): Promise<MentionCandidate[]> {
    const sourceCollection = collection === 'likes' ? this.databaseService.likes : this.databaseService.tweets
    const match = collection === 'likes' ? { tweet_id: contextTweetId } : { parent_id: contextTweetId }
    return sourceCollection
      .aggregate<MentionCandidate>([
        { $match: match },
        { $sort: { created_at: -1, _id: -1 } },
        {
          $lookup: {
            from: this.databaseService.users.collectionName,
            localField: 'user_id',
            foreignField: '_id',
            as: 'candidate'
          }
        },
        { $unwind: '$candidate' },
        { $replaceRoot: { newRoot: '$candidate' } },
        { $match: this.createAvailableUserMatch(actorId, queryRegex) },
        {
          $project: {
            _id: 1,
            name: 1,
            username: 1,
            avatar: 1,
            source: { $literal: 'interaction' }
          }
        },
        { $limit: limit }
      ])
      .toArray()
  }

  private async getUsersByIds(
    ids: ObjectId[],
    actorId: ObjectId,
    source: MentionCandidateSource,
    queryRegex: RegExp | undefined,
    limit: number
  ): Promise<MentionCandidate[]> {
    if (ids.length === 0) return []
    const filter: Filter<User> = {
      _id: { $in: ids },
      ...this.createAvailableUserMatch(actorId, queryRegex)
    }
    const users = await this.databaseService.users
      .find(filter, { projection: { _id: 1, name: 1, username: 1, avatar: 1 }, limit })
      .toArray()
    return users.map((user) => ({
      _id: user._id as ObjectId,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
      source
    }))
  }

  private createAvailableUserMatch(actorId: ObjectId, queryRegex?: RegExp): Filter<User> {
    return {
      _id: { $ne: actorId },
      verify: { $ne: UserVerifyStatus.Banned },
      username: { $type: 'string', $ne: '' },
      ...(queryRegex ? { $or: [{ username: queryRegex }, { name: queryRegex }] } : {})
    }
  }

  private async getBlockedCandidateIds(
    actorId: ObjectId,
    candidateIds: ObjectId[],
    session?: ClientSession
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set()
    const blocks = await this.databaseService.userBlocks
      .find(
        {
          $or: [
            { user_id: actorId, blocked_user_id: { $in: candidateIds } },
            { user_id: { $in: candidateIds }, blocked_user_id: actorId }
          ]
        },
        { projection: { user_id: 1, blocked_user_id: 1 }, session }
      )
      .toArray()
    return new Set(
      blocks.map((block) =>
        block.user_id.equals(actorId) ? block.blocked_user_id.toHexString() : block.user_id.toHexString()
      )
    )
  }
}

const userMentionCandidateService = new UserMentionCandidateService()
export default userMentionCandidateService
