import type { ClientSession, ObjectId, WithId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { HttpError } from '~/common/http-error'
import { HTTP_STATUS } from '~/constants/httpStatus'
import type ConversationReadState from '~/schemas/ConversationReadState.schema'
import type UserMessageState from '~/schemas/UserMessageState.schema'
import type { ConversationType } from './conversation-access.service'

export interface MessageUnreadInput {
  message_id: ObjectId
  conversation_id: ObjectId
  conversation_type: ConversationType
  sender_id: ObjectId
  recipient_ids: ObjectId[]
  occurred_at: Date
}

export interface ConversationReadSnapshot {
  conversation_id: ObjectId
  conversation_type: ConversationType
  user_id: ObjectId
  last_read_message_id: ObjectId | null
  last_read_at: Date | null
  unread_message_count: number
  updated_at: Date
}

export interface UserMessageSummarySnapshot {
  user_id: ObjectId
  unread_conversation_count: number
  total_unread_message_count: number
  version: number
  updated_at: Date
}

export interface ConversationReadMutationResult {
  read_state: ConversationReadSnapshot
  summary: UserMessageSummarySnapshot
}

type PendingConversationIncrement = {
  conversation_id: ObjectId
  conversation_type: ConversationType
  user_id: ObjectId
  count: number
  occurred_at: Date
}

const readStateKey = (conversationId: ObjectId, userId: ObjectId) =>
  `${conversationId.toHexString()}:${userId.toHexString()}`

const toReadSnapshot = (state: WithId<ConversationReadState>): ConversationReadSnapshot => ({
  conversation_id: state.conversation_id,
  conversation_type: state.conversation_type,
  user_id: state.user_id,
  last_read_message_id: state.last_read_message_id ?? null,
  last_read_at: state.last_read_at ?? null,
  unread_message_count: Math.max(0, state.unread_message_count),
  updated_at: state.updated_at
})

const toSummarySnapshot = (state: WithId<UserMessageState>): UserMessageSummarySnapshot => ({
  user_id: state.user_id,
  unread_conversation_count: Math.max(0, state.unread_conversation_count),
  total_unread_message_count: Math.max(0, state.total_unread_message_count),
  version: Math.max(0, state.version),
  updated_at: state.updated_at
})

export class ConversationReadService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async incrementForMessages(
    messages: MessageUnreadInput[],
    session: ClientSession
  ): Promise<ConversationReadMutationResult[]> {
    if (!session.inTransaction()) throw new Error('Unread state must be updated in the message transaction')

    const increments = new Map<string, PendingConversationIncrement>()
    for (const message of messages) {
      for (const recipientId of message.recipient_ids) {
        if (recipientId.equals(message.sender_id)) continue
        const key = readStateKey(message.conversation_id, recipientId)
        const current = increments.get(key)
        if (current) {
          current.count += 1
          if (message.occurred_at > current.occurred_at) current.occurred_at = message.occurred_at
        } else {
          increments.set(key, {
            conversation_id: message.conversation_id,
            conversation_type: message.conversation_type,
            user_id: recipientId,
            count: 1,
            occurred_at: message.occurred_at
          })
        }
      }
    }
    const pending = [...increments.values()]
    if (pending.length === 0) return []

    const existingStates = await this.databaseService.conversationReadStates
      .find(
        {
          $or: pending.map((item) => ({
            conversation_id: item.conversation_id,
            user_id: item.user_id
          }))
        },
        { session }
      )
      .toArray()
    const existingByKey = new Map(
      existingStates.map((state) => [readStateKey(state.conversation_id, state.user_id), state])
    )

    await this.databaseService.conversationReadStates.bulkWrite(
      pending.map((item) => ({
        updateOne: {
          filter: { conversation_id: item.conversation_id, user_id: item.user_id },
          update: [
            {
              $set: {
                conversation_id: item.conversation_id,
                conversation_type: item.conversation_type,
                user_id: item.user_id,
                last_read_message_id: { $ifNull: ['$last_read_message_id', null] },
                last_read_at: { $ifNull: ['$last_read_at', null] },
                unread_message_count: {
                  $add: [{ $ifNull: ['$unread_message_count', 0] }, item.count]
                },
                created_at: { $ifNull: ['$created_at', item.occurred_at] },
                updated_at: item.occurred_at
              }
            }
          ],
          upsert: true
        }
      })),
      { session, ordered: false }
    )

    const summaryDeltas = new Map<
      string,
      { user_id: ObjectId; message_count: number; conversation_count: number; at: Date }
    >()
    for (const item of pending) {
      const existing = existingByKey.get(readStateKey(item.conversation_id, item.user_id))
      const key = item.user_id.toHexString()
      const delta = summaryDeltas.get(key) ?? {
        user_id: item.user_id,
        message_count: 0,
        conversation_count: 0,
        at: item.occurred_at
      }
      delta.message_count += item.count
      if (!existing || existing.unread_message_count === 0) delta.conversation_count += 1
      if (item.occurred_at > delta.at) delta.at = item.occurred_at
      summaryDeltas.set(key, delta)
    }

    await this.databaseService.userMessageStates.bulkWrite(
      [...summaryDeltas.values()].map((delta) => ({
        updateOne: {
          filter: { user_id: delta.user_id },
          update: [
            {
              $set: {
                user_id: delta.user_id,
                unread_conversation_count: {
                  $add: [{ $ifNull: ['$unread_conversation_count', 0] }, delta.conversation_count]
                },
                total_unread_message_count: {
                  $add: [{ $ifNull: ['$total_unread_message_count', 0] }, delta.message_count]
                },
                version: { $add: [{ $ifNull: ['$version', 0] }, 1] },
                updated_at: delta.at
              }
            }
          ],
          upsert: true
        }
      })),
      { session, ordered: false }
    )

    const updatedStates = await this.databaseService.conversationReadStates
      .find(
        {
          $or: pending.map((item) => ({
            conversation_id: item.conversation_id,
            user_id: item.user_id
          }))
        },
        { session }
      )
      .toArray()
    const updatedSummaries = await this.databaseService.userMessageStates
      .find({ user_id: { $in: [...summaryDeltas.values()].map((delta) => delta.user_id) } }, { session })
      .toArray()
    const summaryByUser = new Map(updatedSummaries.map((summary) => [summary.user_id.toHexString(), summary]))

    return updatedStates.map((state) => {
      const summary = summaryByUser.get(state.user_id.toHexString())
      if (!summary) throw new Error('Message unread summary was not persisted')
      return { read_state: toReadSnapshot(state), summary: toSummarySnapshot(summary) }
    })
  }

  async markRead(userId: string, conversationId: string, messageId?: string): Promise<ConversationReadMutationResult> {
    const session = this.databaseService.startSession()
    try {
      let mutation: ConversationReadMutationResult | undefined
      await session.withTransaction(async () => {
        mutation = await this.markReadInTransaction(userId, conversationId, messageId, session)
      })
      if (!mutation) throw new Error('Conversation read transaction returned no state')
      return mutation
    } finally {
      await session.endSession()
    }
  }

  async getConversationStates(userId: string, conversationIds: ObjectId[]): Promise<ConversationReadSnapshot[]> {
    if (conversationIds.length === 0) return []
    const states = await this.databaseService.conversationReadStates
      .find({ user_id: new this.databaseService.ObjectId(userId), conversation_id: { $in: conversationIds } })
      .toArray()
    return states.map(toReadSnapshot)
  }

  async getSummary(userId: string, session?: ClientSession): Promise<UserMessageSummarySnapshot> {
    const userObjectId = new this.databaseService.ObjectId(userId)
    const state = await this.databaseService.userMessageStates.findOne({ user_id: userObjectId }, { session })
    return state
      ? toSummarySnapshot(state)
      : {
          user_id: userObjectId,
          unread_conversation_count: 0,
          total_unread_message_count: 0,
          version: 0,
          updated_at: new Date(0)
        }
  }

  async initializeMembership(
    conversationId: ObjectId,
    conversationType: ConversationType,
    userIds: ObjectId[],
    lastVisibleMessageId: ObjectId | null,
    at: Date,
    session?: ClientSession
  ): Promise<void> {
    if (userIds.length === 0) return
    await this.databaseService.conversationReadStates.bulkWrite(
      userIds.map((userId) => ({
        updateOne: {
          filter: { conversation_id: conversationId, user_id: userId },
          update: {
            $setOnInsert: {
              conversation_id: conversationId,
              conversation_type: conversationType,
              user_id: userId,
              last_read_message_id: lastVisibleMessageId,
              last_read_at: at,
              unread_message_count: 0,
              created_at: at,
              updated_at: at
            }
          },
          upsert: true
        }
      })),
      { session, ordered: false }
    )
  }

  async clearMembershipInTransaction(
    conversationId: ObjectId,
    conversationType: ConversationType,
    userId: ObjectId,
    at: Date,
    session: ClientSession
  ): Promise<ConversationReadMutationResult | null> {
    if (!session.inTransaction()) throw new Error('Membership unread cleanup must run in the membership transaction')

    const existing = await this.databaseService.conversationReadStates.findOneAndDelete(
      { conversation_id: conversationId, user_id: userId },
      { session }
    )
    if (!existing) return null

    const oldUnread = Math.max(0, existing.unread_message_count)
    const summary = await this.applyReadDelta(userId, oldUnread, oldUnread > 0 ? -1 : 0, at, session)
    return {
      read_state: {
        conversation_id: conversationId,
        conversation_type: conversationType,
        user_id: userId,
        last_read_message_id: existing.last_read_message_id ?? null,
        last_read_at: at,
        unread_message_count: 0,
        updated_at: at
      },
      summary
    }
  }

  async clearForHistoryInTransaction(
    conversationId: ObjectId,
    conversationType: ConversationType,
    userId: ObjectId,
    lastReadMessageId: ObjectId | null,
    at: Date,
    session: ClientSession
  ): Promise<ConversationReadMutationResult> {
    if (!session.inTransaction()) throw new Error('History unread cleanup must run in the history transaction')

    const existing = await this.databaseService.conversationReadStates.findOne(
      { conversation_id: conversationId, user_id: userId },
      { session }
    )
    const oldUnread = Math.max(0, existing?.unread_message_count ?? 0)
    const state = await this.databaseService.conversationReadStates.findOneAndUpdate(
      { conversation_id: conversationId, user_id: userId },
      {
        $set: {
          conversation_type: conversationType,
          last_read_message_id: lastReadMessageId,
          last_read_at: at,
          unread_message_count: 0,
          updated_at: at
        },
        $setOnInsert: {
          conversation_id: conversationId,
          user_id: userId,
          created_at: at
        }
      },
      { session, upsert: true, returnDocument: 'after' }
    )
    if (!state) throw new Error('History unread cleanup returned no state')

    const summary = await this.applyReadDelta(userId, oldUnread, oldUnread > 0 ? -1 : 0, at, session)
    return { read_state: toReadSnapshot(state), summary }
  }

  async reconcileSummary(userId: string): Promise<UserMessageSummarySnapshot> {
    const userObjectId = new this.databaseService.ObjectId(userId)
    const [aggregate] = await this.databaseService.conversationReadStates
      .aggregate<{ unread_conversation_count: number; total_unread_message_count: number }>([
        { $match: { user_id: userObjectId, unread_message_count: { $gt: 0 } } },
        {
          $group: {
            _id: '$user_id',
            unread_conversation_count: { $sum: 1 },
            total_unread_message_count: { $sum: '$unread_message_count' }
          }
        }
      ])
      .toArray()
    const now = new Date()
    const state = await this.databaseService.userMessageStates.findOneAndUpdate(
      { user_id: userObjectId },
      {
        $set: {
          unread_conversation_count: aggregate?.unread_conversation_count ?? 0,
          total_unread_message_count: aggregate?.total_unread_message_count ?? 0,
          updated_at: now
        },
        $inc: { version: 1 },
        $setOnInsert: { user_id: userObjectId }
      },
      { upsert: true, returnDocument: 'after' }
    )
    if (!state) throw new Error('Conversation unread reconciliation returned no summary')
    return toSummarySnapshot(state)
  }

  private async markReadInTransaction(
    userId: string,
    conversationId: string,
    messageId: string | undefined,
    session: ClientSession
  ): Promise<ConversationReadMutationResult> {
    const userObjectId = new this.databaseService.ObjectId(userId)
    const conversationObjectId = new this.databaseService.ObjectId(conversationId)
    const direct = await this.databaseService.directConversations.findOne(
      {
        _id: conversationObjectId,
        $or: [{ user1_id: userObjectId }, { user2_id: userObjectId }]
      },
      { session }
    )
    const group = direct
      ? null
      : await this.databaseService.groupConversations.findOne(
          { _id: conversationObjectId, 'members.user_id': userObjectId },
          { session }
        )
    if (!direct && !group) throw new HttpError('Conversation not found or access denied', HTTP_STATUS.FORBIDDEN)
    const conversationType: ConversationType = direct ? 'direct' : 'group'
    const conversation = direct ?? group
    const cutoff = conversation?.history_cleared_by?.find((marker) =>
      marker.user_id.equals(userObjectId)
    )?.cleared_through_message_id

    const visibilityFilter = {
      conversation_id: conversationObjectId,
      status: { $in: ['sent', 'revoked'] as const },
      deleted_by: { $ne: userObjectId },
      ...(cutoff ? { _id: { $gt: cutoff } } : {})
    }
    const targetMessage = messageId
      ? await this.databaseService.messages.findOne(
          {
            ...visibilityFilter,
            _id: new this.databaseService.ObjectId(messageId)
          },
          { session, projection: { _id: 1 } }
        )
      : await this.databaseService.messages
          .find(visibilityFilter, { session, projection: { _id: 1 } })
          .sort({ _id: -1 })
          .limit(1)
          .next()
    if (messageId && !targetMessage) {
      throw new HttpError('Message is not visible in this conversation', HTTP_STATUS.BAD_REQUEST)
    }

    const existing = await this.databaseService.conversationReadStates.findOne(
      { conversation_id: conversationObjectId, user_id: userObjectId },
      { session }
    )
    const oldUnread = Math.max(0, existing?.unread_message_count ?? 0)
    const requestedTargetMessageId = targetMessage?._id ?? existing?.last_read_message_id ?? null
    const alreadyReadThroughTarget = Boolean(
      requestedTargetMessageId &&
        existing?.last_read_message_id &&
        existing.last_read_message_id.toHexString() >= requestedTargetMessageId.toHexString()
    )
    const targetMessageId = alreadyReadThroughTarget
      ? (existing?.last_read_message_id ?? requestedTargetMessageId)
      : requestedTargetMessageId
    let remainingUnread = oldUnread
    if (!alreadyReadThroughTarget) {
      if (!messageId) {
        remainingUnread = 0
      } else if (targetMessageId) {
        const lowerBound = existing?.last_read_message_id ?? cutoff
        const acknowledgedUnread = await this.databaseService.messages.countDocuments(
          {
            conversation_id: conversationObjectId,
            _id: {
              ...(lowerBound ? { $gt: lowerBound } : {}),
              $lte: targetMessageId
            },
            sender_id: { $ne: userObjectId },
            status: { $in: ['sent', 'revoked'] },
            deleted_by: { $ne: userObjectId }
          },
          { session }
        )
        remainingUnread = Math.max(0, oldUnread - Math.min(oldUnread, acknowledgedUnread))
      }
    }
    const readAt = new Date()
    const state = await this.databaseService.conversationReadStates.findOneAndUpdate(
      { conversation_id: conversationObjectId, user_id: userObjectId },
      {
        $set: {
          conversation_type: conversationType,
          last_read_message_id: targetMessageId,
          last_read_at: readAt,
          unread_message_count: remainingUnread,
          updated_at: readAt
        },
        $setOnInsert: {
          conversation_id: conversationObjectId,
          user_id: userObjectId,
          created_at: readAt
        }
      },
      { session, upsert: true, returnDocument: 'after' }
    )
    if (!state) throw new Error('Conversation read mutation returned no state')

    const readDelta = Math.max(0, oldUnread - remainingUnread)
    const conversationDelta = oldUnread > 0 && remainingUnread === 0 ? -1 : 0
    const summary = await this.applyReadDelta(userObjectId, readDelta, conversationDelta, readAt, session)
    return { read_state: toReadSnapshot(state), summary }
  }

  private async applyReadDelta(
    userId: ObjectId,
    readDelta: number,
    conversationDelta: number,
    at: Date,
    session: ClientSession
  ): Promise<UserMessageSummarySnapshot> {
    let summary: WithId<UserMessageState> | null
    if (readDelta > 0) {
      summary = await this.databaseService.userMessageStates.findOneAndUpdate(
        { user_id: userId },
        [
          {
            $set: {
              user_id: userId,
              unread_conversation_count: {
                $max: [0, { $add: [{ $ifNull: ['$unread_conversation_count', 0] }, conversationDelta] }]
              },
              total_unread_message_count: {
                $max: [0, { $add: [{ $ifNull: ['$total_unread_message_count', 0] }, -readDelta] }]
              },
              version: { $add: [{ $ifNull: ['$version', 0] }, 1] },
              updated_at: at
            }
          }
        ],
        { session, upsert: true, returnDocument: 'after' }
      )
    } else {
      summary = await this.databaseService.userMessageStates.findOne({ user_id: userId }, { session })
    }
    return summary
      ? toSummarySnapshot(summary)
      : {
          user_id: userId,
          unread_conversation_count: 0,
          total_unread_message_count: 0,
          version: 0,
          updated_at: at
        }
  }
}

const conversationReadService = new ConversationReadService()
export default conversationReadService
