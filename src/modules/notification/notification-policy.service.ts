import type { ClientSession, ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationTargetType, NotificationType, TweetAudience, TweetType, UserVerifyStatus } from '~/constants/enums'
import type {
  TweetCreatedEvent,
  TweetMentionsChangedEvent,
  TweetLikedEvent,
  TweetRepostedEvent,
  UserFollowedEvent,
  MessageCreatedEvent,
  GroupManagementChangedEvent
} from '~/modules/events/domain-event.type'
import { DomainEventType } from '~/modules/events/domain-event.type'
import { NotificationLifecycleGuardService } from './notification-lifecycle-guard.service'
import type {
  AggregateNotificationDecision,
  CreateNotificationCommand,
  NotificationPolicyDecision,
  TweetNotificationPlan,
  MessageNotificationPlan,
  GroupManagementNotificationPlan,
  FollowedUserTweetNotificationPlan
} from './notification.type'

export const inferLegacyNotificationTargetType = (type: NotificationType): NotificationTargetType | undefined => {
  switch (type) {
    case NotificationType.Follow:
      return NotificationTargetType.User
    case NotificationType.Like:
    case NotificationType.Reply:
    case NotificationType.Retweet:
    case NotificationType.Quote:
    case NotificationType.Mention:
      return NotificationTargetType.Tweet
    case NotificationType.Message:
    case NotificationType.GroupAdd:
    case NotificationType.GroupJoin:
    case NotificationType.GroupKick:
    case NotificationType.AdminGranted:
    case NotificationType.AdminRevoked:
      return NotificationTargetType.Conversation
    case NotificationType.MessageReply:
    case NotificationType.MessageMention:
    case NotificationType.MessageReaction:
      return NotificationTargetType.Message
    case NotificationType.FollowedUserTweet:
      return NotificationTargetType.Tweet
    case NotificationType.System:
      return undefined
  }
}

export class NotificationPolicyService {
  constructor(
    private readonly databaseService: DatabaseService = sharedDatabaseService,
    private readonly lifecycleGuard: NotificationLifecycleGuardService = new NotificationLifecycleGuardService(
      databaseService
    )
  ) {}

  evaluateLegacy(command: CreateNotificationCommand): NotificationPolicyDecision {
    if (command.type === NotificationType.Message || command.type === NotificationType.MessageReaction) {
      return { action: 'skip', reason: 'unsupported_type' }
    }
    if (command.sender_id?.equals(command.recipient_id)) {
      return { action: 'skip', reason: 'self_notification' }
    }

    return {
      action: 'create',
      command: {
        ...command,
        target_type: command.target_type ?? inferLegacyNotificationTargetType(command.type)
      }
    }
  }

  async evaluateUserFollowed(event: UserFollowedEvent, session?: ClientSession): Promise<NotificationPolicyDecision> {
    if (event.payload.follower_id.equals(event.payload.followed_user_id)) {
      return { action: 'skip', reason: 'self_notification' }
    }

    const relation = await this.databaseService.followers.findOne(
      {
        _id: event.payload.relation_id,
        follow_user_id: event.payload.follower_id,
        followed_user_id: event.payload.followed_user_id
      },
      { session }
    )
    if (!relation) return { action: 'skip', reason: 'relation_missing' }
    const eligible = await this.loadEligibleRecipientIds(
      event.actor_id,
      [event.payload.followed_user_id],
      event.occurred_at,
      session
    )
    if (!eligible.has(event.payload.followed_user_id.toHexString())) {
      return { action: 'skip', reason: 'privacy_restricted' }
    }

    return {
      action: 'create',
      command: {
        recipient_id: event.payload.followed_user_id,
        sender_id: event.payload.follower_id,
        type: NotificationType.Follow,
        target_id: event.payload.follower_id,
        target_type: NotificationTargetType.User,
        context: {},
        created_at: event.occurred_at
      }
    }
  }

  async resolveGroupManagementPlan(
    event: GroupManagementChangedEvent,
    session?: ClientSession
  ): Promise<GroupManagementNotificationPlan> {
    if (!event.payload.notification_type || event.payload.direct_recipient_ids.length === 0) {
      return { commands: [] }
    }
    const eligible = await this.loadEligibleRecipientIds(
      event.actor_id,
      event.payload.direct_recipient_ids,
      event.occurred_at,
      session
    )
    return {
      commands: event.payload.direct_recipient_ids.filter((recipient) => eligible.has(recipient.toHexString())).map((recipient) => ({
        recipient_id: recipient,
        sender_id: event.actor_id,
        type: event.payload.notification_type as Exclude<
          GroupManagementChangedEvent['payload']['notification_type'],
          null
        >,
        target_id: event.payload.conversation_id,
        target_type: NotificationTargetType.Conversation,
        context: {
          system_event_type: event.payload.system_event_type,
          system_message_id: event.payload.system_message_id,
          affected_user_ids: event.payload.affected_user_ids
        },
        created_at: event.occurred_at
      }))
    }
  }

  async resolveFollowedUserTweetPlan(
    event: TweetCreatedEvent,
    recipientIds: ObjectId[],
    session?: ClientSession
  ): Promise<FollowedUserTweetNotificationPlan> {
    if (event.payload.tweet_type !== TweetType.Tweet || event.payload.audience !== TweetAudience.Everyone) {
      return { commands: [] }
    }
    if (session) {
      const predatesRestore = await this.lifecycleGuard.touchTarget(
        NotificationTargetType.Tweet,
        event.payload.tweet_id,
        event.occurred_at,
        session
      )
      if (predatesRestore) return { commands: [] }
    }
    const tweet = await this.databaseService.tweets.findOne(
      {
        _id: event.payload.tweet_id,
        user_id: event.actor_id,
        type: TweetType.Tweet,
        audience: TweetAudience.Everyone
      },
      { projection: { _id: 1 }, session }
    )
    if (!tweet) return { commands: [] }

    const uniqueRecipientIds = [...new Map(recipientIds.map((id) => [id.toHexString(), id])).values()].filter(
      (id) => !id.equals(event.actor_id)
    )
    if (uniqueRecipientIds.length === 0) return { commands: [] }
    const eligible = await this.loadEligibleRecipientIds(event.actor_id, uniqueRecipientIds, event.occurred_at, session)
    return {
      commands: uniqueRecipientIds
        .filter((recipient) => eligible.has(recipient.toHexString()))
        .map((recipient) => ({
          recipient_id: recipient,
          sender_id: event.actor_id,
          type: NotificationType.FollowedUserTweet,
          target_id: tweet._id,
          target_type: NotificationTargetType.Tweet,
          context: {},
          created_at: event.occurred_at
        }))
    }
  }

  async resolveTweetPlan(
    event: TweetCreatedEvent | TweetMentionsChangedEvent,
    candidateMentionIds: ObjectId[],
    session?: ClientSession
  ): Promise<TweetNotificationPlan> {
    if (session) {
      const predatesRestore = await this.lifecycleGuard.touchTarget(
        NotificationTargetType.Tweet,
        event.payload.tweet_id,
        event.occurred_at,
        session
      )
      if (predatesRestore) return { commands: [], primary: null, current_mention_ids: [] }
    }
    const tweet = await this.databaseService.tweets.findOne(
      { _id: event.payload.tweet_id, user_id: event.actor_id },
      { session }
    )
    if (!tweet || tweet.audience !== TweetAudience.Everyone) {
      return { commands: [], primary: null, current_mention_ids: [] }
    }
    if (tweet.type === TweetType.Retweet) return { commands: [], primary: null, current_mention_ids: [] }

    const currentMentionIds = new Map(tweet.mentions.map((id) => [id.toHexString(), id]))
    const candidates = new Map<string, ObjectId>()
    for (const id of candidateMentionIds) {
      const currentId = currentMentionIds.get(id.toHexString())
      if (currentId && !currentId.equals(event.actor_id)) candidates.set(currentId.toHexString(), currentId)
    }

    const parent = tweet.parent_id
      ? await this.databaseService.tweets.findOne(
          { _id: tweet.parent_id },
          { projection: { _id: 1, user_id: 1 }, session }
        )
      : null
    const primaryType =
      tweet.type === TweetType.Comment
        ? NotificationType.Reply
        : tweet.type === TweetType.QuoteTweet
          ? NotificationType.Quote
          : null
    const primaryRecipient = primaryType && parent ? parent.user_id : null
    const recipientIds = new Map<string, ObjectId>(candidates)
    if (primaryRecipient && !primaryRecipient.equals(event.actor_id)) {
      recipientIds.set(primaryRecipient.toHexString(), primaryRecipient)
    }

    const ids = [...recipientIds.values()]
    if (ids.length === 0) {
      return { commands: [], primary: null, current_mention_ids: [...currentMentionIds.values()] }
    }
    const eligible = await this.loadEligibleRecipientIds(event.actor_id, ids, event.occurred_at, session)
    const canNotify = (recipientId: ObjectId) => eligible.has(recipientId.toHexString())

    const commands: CreateNotificationCommand[] = []
    let primary: TweetNotificationPlan['primary'] = null
    if (primaryType && primaryRecipient && parent && canNotify(primaryRecipient)) {
      const mentioned = currentMentionIds.has(primaryRecipient.toHexString())
      primary = {
        recipient_id: primaryRecipient,
        type: primaryType,
        parent_tweet_id: parent._id,
        mentioned
      }
      commands.push({
        recipient_id: primaryRecipient,
        sender_id: event.actor_id,
        type: primaryType,
        target_id: tweet._id,
        target_type: NotificationTargetType.Tweet,
        context: { parent_tweet_id: parent._id, mentioned },
        created_at: event.occurred_at
      })
    }

    for (const recipientId of candidates.values()) {
      if (primaryRecipient?.equals(recipientId) || !canNotify(recipientId)) continue
      commands.push({
        recipient_id: recipientId,
        sender_id: event.actor_id,
        type: NotificationType.Mention,
        target_id: tweet._id,
        target_type: NotificationTargetType.Tweet,
        context: tweet.parent_id ? { parent_tweet_id: tweet.parent_id } : {},
        created_at: event.occurred_at
      })
    }

    return { commands, primary, current_mention_ids: [...currentMentionIds.values()] }
  }

  async resolveMessagePlan(
    event: MessageCreatedEvent,
    session?: ClientSession
  ): Promise<MessageNotificationPlan> {
    if (session) {
      const predatesRestore = await this.lifecycleGuard.touchTarget(
        NotificationTargetType.Message,
        event.payload.message_id,
        event.occurred_at,
        session
      )
      if (predatesRestore) return { commands: [] }
    }
    const message = await this.databaseService.messages.findOne(
      {
        _id: event.payload.message_id,
        sender_id: event.actor_id,
        conversation_id: event.payload.conversation_id,
        conversation_type: event.payload.conversation_type,
        status: 'sent'
      },
      { session }
    )
    if (!message) return { commands: [] }

    const recipientIds = new Map(event.payload.recipient_ids.map((id) => [id.toHexString(), id]))
    recipientIds.delete(event.actor_id.toHexString())
    for (const deletedByUserId of message.deleted_by) {
      recipientIds.delete(deletedByUserId.toHexString())
    }
    if (recipientIds.size === 0) return { commands: [] }

    const eligible = await this.loadEligibleRecipientIds(
      event.actor_id,
      [...recipientIds.values()],
      event.occurred_at,
      session
    )
    const mentionIds = new Map<string, ObjectId>()
    if (event.payload.conversation_type === 'group') {
      for (const mentionId of event.payload.mention_user_ids) {
        const key = mentionId.toHexString()
        if (recipientIds.has(key) && eligible.has(key)) mentionIds.set(key, mentionId)
      }
    }

    let replyRecipient: ObjectId | null = null
    if (event.payload.reply_to_message_id) {
      const replyTarget = await this.databaseService.messages.findOne(
        {
          _id: event.payload.reply_to_message_id,
          conversation_id: event.payload.conversation_id,
          conversation_type: event.payload.conversation_type,
          status: 'sent'
        },
        { projection: { sender_id: 1 }, session }
      )
      if (
        replyTarget &&
        !replyTarget.sender_id.equals(event.actor_id) &&
        recipientIds.has(replyTarget.sender_id.toHexString()) &&
        eligible.has(replyTarget.sender_id.toHexString())
      ) {
        replyRecipient = replyTarget.sender_id
      }
    }

    const context = {
      conversation_id: event.payload.conversation_id,
      conversation_type: event.payload.conversation_type,
      ...(event.payload.reply_to_message_id
        ? { reply_to_message_id: event.payload.reply_to_message_id }
        : {})
    }
    const commands: CreateNotificationCommand[] = []
    for (const mentionId of mentionIds.values()) {
      commands.push({
        recipient_id: mentionId,
        sender_id: event.actor_id,
        type: NotificationType.MessageMention,
        target_id: event.payload.message_id,
        target_type: NotificationTargetType.Message,
        context,
        created_at: event.occurred_at
      })
    }
    if (replyRecipient && !mentionIds.has(replyRecipient.toHexString())) {
      commands.push({
        recipient_id: replyRecipient,
        sender_id: event.actor_id,
        type: NotificationType.MessageReply,
        target_id: event.payload.message_id,
        target_type: NotificationTargetType.Message,
        context,
        created_at: event.occurred_at
      })
    }
    return { commands }
  }

  async evaluateTweetAggregation(
    event: TweetLikedEvent | TweetRepostedEvent,
    session?: ClientSession
  ): Promise<AggregateNotificationDecision> {
    if (session) {
      const predatesRestore = await this.lifecycleGuard.touchTarget(
        NotificationTargetType.Tweet,
        event.payload.tweet_id,
        event.occurred_at,
        session
      )
      if (predatesRestore) return { action: 'skip', reason: 'target_missing' }
    }
    const sourceExists =
      event.type === DomainEventType.TweetLiked
        ? await this.databaseService.likes.findOne(
            { _id: event.payload.relation_id, user_id: event.actor_id, tweet_id: event.payload.tweet_id },
            { projection: { _id: 1 }, session }
          )
        : await this.databaseService.tweets.findOne(
            {
              _id: event.payload.relation_id,
              user_id: event.actor_id,
              parent_id: event.payload.tweet_id,
              type: TweetType.Retweet
            },
            { projection: { _id: 1 }, session }
          )
    if (!sourceExists) return { action: 'skip', reason: 'relation_missing' }

    const target = await this.databaseService.tweets.findOne(
      { _id: event.payload.tweet_id, audience: TweetAudience.Everyone },
      { projection: { _id: 1, user_id: 1 }, session }
    )
    if (!target) return { action: 'skip', reason: 'target_missing' }
    if (target.user_id.equals(event.actor_id)) return { action: 'skip', reason: 'self_notification' }

    const eligible = await this.loadEligibleRecipientIds(event.actor_id, [target.user_id], event.occurred_at, session)
    if (!eligible.has(target.user_id.toHexString())) return { action: 'skip', reason: 'privacy_restricted' }

    const type = event.type === DomainEventType.TweetLiked ? NotificationType.Like : NotificationType.Retweet
    return {
      action: 'aggregate',
      command: {
        recipient_id: target.user_id,
        actor_id: event.actor_id,
        type,
        target_id: target._id,
        target_type: NotificationTargetType.Tweet,
        aggregation_key: `${target.user_id.toHexString()}:${type.toUpperCase()}:${target._id.toHexString()}`,
        source_key: `${event.payload.source_type}:${event.payload.source_id}`,
        event_id: event.event_id,
        context: {},
        occurred_at: event.occurred_at
      }
    }
  }

  private async loadEligibleRecipientIds(
    actorId: ObjectId,
    recipientIds: ObjectId[],
    occurredAt: Date,
    session?: ClientSession
  ): Promise<Set<string>> {
    const uniqueRecipients = [...new Map(recipientIds.map((id) => [id.toHexString(), id])).values()].filter(
      (id) => !id.equals(actorId)
    )
    if (uniqueRecipients.length === 0) return new Set()
    const invalidatedByCompletedBlock = new Set<string>()
    if (session) {
      for (const recipient of uniqueRecipients) {
        if (await this.lifecycleGuard.touchUserPair(actorId, recipient, occurredAt, session)) {
          invalidatedByCompletedBlock.add(recipient.toHexString())
        }
      }
    }
    const actor = await this.databaseService.users.findOne(
      { _id: actorId, verify: { $ne: UserVerifyStatus.Banned } },
      { projection: { _id: 1 }, session }
    )
    if (!actor) return new Set()

    const [recipients, blocks] = await Promise.all([
      this.databaseService.users
        .find(
          { _id: { $in: uniqueRecipients }, verify: { $ne: UserVerifyStatus.Banned } },
          { projection: { _id: 1 }, session }
        )
        .toArray(),
      this.databaseService.userBlocks
        .find(
          {
            $or: [
              { user_id: actorId, blocked_user_id: { $in: uniqueRecipients } },
              { user_id: { $in: uniqueRecipients }, blocked_user_id: actorId }
            ]
          },
          { projection: { user_id: 1, blocked_user_id: 1 }, session }
        )
        .toArray()
    ])
    const blocked = new Set(
      blocks.map((relation) =>
        relation.user_id.equals(actorId) ? relation.blocked_user_id.toHexString() : relation.user_id.toHexString()
      )
    )
    return new Set(
      recipients
        .map((recipient) => recipient._id.toHexString())
        .filter((id) => !blocked.has(id) && !invalidatedByCompletedBlock.has(id))
    )
  }
}
