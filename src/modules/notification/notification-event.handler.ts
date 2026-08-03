import type { DomainEventHandler, DomainEventPublishOptions } from '~/modules/events/domain-event.publisher'
import {
  DomainEventType,
  parseDomainEvent,
  type TweetCreatedEvent
} from '~/modules/events/domain-event.type'
import type { ObjectId } from 'mongodb'
import { NotificationType } from '~/constants/enums'
import { NotificationDeliveryService } from './notification-delivery.service'
import type {
  NotificationEventHandlerOptions,
  NotificationEventHandlerResult,
  NotificationMutationResult
} from './notification-event.type'
import { NotificationPolicyService } from './notification-policy.service'
import { NotificationRepository } from './notification.repository'
import type { CreateNotificationCommand } from './notification.type'
import { NotificationAggregationService } from './notification-aggregation.service'
import { envConfig } from '~/config/getEnvConfig'
import { NotificationLifecycleService } from './notification-lifecycle.service'

export class NotificationEventHandler implements DomainEventHandler<NotificationEventHandlerResult> {
  constructor(
    private readonly repository: NotificationRepository = new NotificationRepository(),
    private readonly policyService: NotificationPolicyService = new NotificationPolicyService(),
    private readonly deliveryService: NotificationDeliveryService = new NotificationDeliveryService(),
    private readonly aggregationService: NotificationAggregationService = new NotificationAggregationService(),
    private readonly lifecycleService: NotificationLifecycleService = new NotificationLifecycleService()
  ) {}

  async handle(
    eventValue: unknown,
    options: DomainEventPublishOptions & NotificationEventHandlerOptions = {}
  ): Promise<NotificationEventHandlerResult> {
    const event = parseDomainEvent(eventValue)

    switch (event.type) {
      case DomainEventType.LegacyNotificationRequested: {
        const decision = this.policyService.evaluateLegacy({
          recipient_id: event.payload.recipient_id,
          sender_id: event.actor_id,
          type: event.payload.notification_type,
          target_id: event.payload.target_id,
          target_type: event.payload.target_type,
          context: event.payload.context,
          created_at: event.occurred_at
        })
        if (decision.action === 'skip') {
          return { status: 'suppressed', notification: null, reason: decision.reason }
        }
        const result = await this.persistIndividual(
          decision.command,
          event.payload.source_type,
          event.payload.source_id,
          event.occurred_at,
          options
        )
        if (options.deliver !== false) this.deliverMutation(result)
        return result
      }
      case DomainEventType.UserFollowed: {
        const decision = await this.policyService.evaluateUserFollowed(event, options.session)
        if (decision.action === 'skip') {
          return { status: 'suppressed', notification: null, reason: decision.reason }
        }
        const result = await this.persistIndividual(
          decision.command,
          event.payload.source_type,
          event.payload.source_id,
          event.occurred_at,
          options
        )
        if (options.deliver !== false) this.deliverMutation(result)
        return result
      }
      case DomainEventType.TweetCreated: {
        const plan = await this.policyService.resolveTweetPlan(event, event.payload.mention_ids, options.session)
        const results: NotificationMutationResult[] = []
        for (const command of plan.commands) {
          results.push(
            await this.persistIndividual(
              command,
              event.payload.source_type,
              event.payload.source_id,
              event.occurred_at,
              options
            )
          )
        }
        const result: NotificationEventHandlerResult = results.length
          ? { status: 'batch', results }
          : { status: 'suppressed', notification: null, reason: 'no_eligible_recipient' }
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.TweetMentionsChanged: {
        if (event.payload.visibility_revoked) {
          if (!options.session) throw new Error('Tweet lifecycle event requires an active MongoDB session')
          const result = await this.lifecycleService.handleTweetVisibilityRevoked(event, options.session)
          if (options.deliver !== false) this.deliverResult(result)
          return result
        }
        const plan = await this.policyService.resolveTweetPlan(event, event.payload.added_mention_ids, options.session)
        const results: NotificationMutationResult[] = []
        for (const command of plan.commands) {
          if (command.type !== NotificationType.Mention) continue
          results.push(
            await this.persistIndividual(command, 'TWEET', event.payload.source_id, event.occurred_at, options)
          )
        }
        const currentMentionIds = new Set(plan.current_mention_ids.map((id) => id.toHexString()))
        for (const recipientId of event.payload.removed_mention_ids) {
          if (currentMentionIds.has(recipientId.toHexString()) || recipientId.equals(event.actor_id)) continue
          const invalidated = await this.repository.invalidateByDeduplicationKey(
            this.createDeduplicationKey(
              recipientId.toHexString(),
              NotificationType.Mention,
              'TWEET',
              event.payload.source_id
            ),
            event.occurred_at,
            { session: options.session }
          )
          if (invalidated) results.push(invalidated)
        }
        if (plan.primary) {
          const primaryContext = await this.repository.updateContextByDeduplicationKey(
            this.createDeduplicationKey(
              plan.primary.recipient_id.toHexString(),
              plan.primary.type,
              'TWEET',
              event.payload.source_id
            ),
            { parent_tweet_id: plan.primary.parent_tweet_id, mentioned: plan.primary.mentioned },
            event.occurred_at,
            { session: options.session }
          )
          if (primaryContext) results.push(primaryContext)
        }
        const result: NotificationEventHandlerResult = results.length
          ? { status: 'batch', results }
          : { status: 'suppressed', notification: null, reason: 'no_effective_mention_change' }
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.TweetLiked:
      case DomainEventType.TweetReposted: {
        if (!options.session) throw new Error('Tweet aggregation event requires an active MongoDB session')
        const decision = await this.policyService.evaluateTweetAggregation(event, options.session)
        if (decision.action === 'skip') {
          return { status: 'suppressed', notification: null, reason: decision.reason }
        }
        const result = await this.aggregationService.addActor(decision.command, { session: options.session })
        if (options.deliver !== false) this.deliverMutation(result)
        return result
      }
      case DomainEventType.TweetUnliked:
      case DomainEventType.TweetUndoRepost: {
        if (!options.session) throw new Error('Tweet aggregation undo event requires an active MongoDB session')
        const result = await this.aggregationService.removeActor(
          `${event.payload.source_type}:${event.payload.source_id}`,
          event.occurred_at,
          { session: options.session }
        )
        if (options.deliver !== false) this.deliverMutation(result)
        return result
      }
      case DomainEventType.MessageCreated: {
        if (!envConfig.features.notificationMessageDirectedEnabled) {
          return { status: 'suppressed', notification: null, reason: 'message_directed_disabled' }
        }
        const plan = await this.policyService.resolveMessagePlan(event, options.session)
        const results: NotificationMutationResult[] = []
        for (const command of plan.commands) {
          results.push(
            await this.persistIndividual(
              command,
              event.payload.source_type,
              event.payload.source_id,
              event.occurred_at,
              options
            )
          )
        }
        const result: NotificationEventHandlerResult = results.length
          ? { status: 'batch', results }
          : { status: 'suppressed', notification: null, reason: 'no_directed_message_recipient' }
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.GroupManagementChanged: {
        if (!envConfig.features.notificationGroupManagementEnabled) {
          return { status: 'suppressed', notification: null, reason: 'group_management_disabled' }
        }
        const plan = await this.policyService.resolveGroupManagementPlan(event, options.session)
        const results: NotificationMutationResult[] = []
        for (const command of plan.commands) {
          results.push(
            await this.persistIndividual(
              command,
              event.payload.source_type,
              event.payload.source_id,
              event.occurred_at,
              options
            )
          )
        }
        const result: NotificationEventHandlerResult = results.length
          ? { status: 'batch', results }
          : { status: 'suppressed', notification: null, reason: 'no_group_notification_recipient' }
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.MessageReactionChanged:
      case DomainEventType.MessageReactionRemoved: {
        return { status: 'suppressed', notification: null, reason: 'message_reaction_not_supported' }
      }
      case DomainEventType.TweetDeleted: {
        if (!options.session) throw new Error('Tweet lifecycle event requires an active MongoDB session')
        const result = await this.lifecycleService.handleTweetDeleted(event, options.session)
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.MessageRevoked: {
        if (!options.session) throw new Error('Message lifecycle event requires an active MongoDB session')
        const result = await this.lifecycleService.handleMessageRevoked(event, options.session)
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.MessageDeletedForRecipient: {
        if (!options.session) throw new Error('Message lifecycle event requires an active MongoDB session')
        const result = await this.lifecycleService.handleMessageDeletedForRecipient(event, options.session)
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.UserBlocked: {
        if (!options.session) throw new Error('Block lifecycle event requires an active MongoDB session')
        const result = await this.lifecycleService.handleUserBlocked(event, options.session)
        if (options.deliver !== false) this.deliverResult(result)
        return result
      }
      case DomainEventType.UserUnblocked:
        return this.lifecycleService.handleUserUnblocked(event)
    }
  }

  deliverAfterCommit(result: NotificationEventHandlerResult): void {
    this.deliverResult(result)
  }

  async handleFollowedUserTweetBatch(
    event: TweetCreatedEvent,
    recipientIds: ObjectId[],
    options: NotificationEventHandlerOptions = {}
  ): Promise<NotificationEventHandlerResult> {
    const plan = await this.policyService.resolveFollowedUserTweetPlan(event, recipientIds, options.session)
    const results: NotificationMutationResult[] = await this.repository.createIndividualNotificationsBatch(
      plan.commands.map((command) => ({
        recipient_id: command.recipient_id,
        sender_id: command.sender_id,
        type: command.type,
        target_id: command.target_id,
        target_type: command.target_type,
        context: command.context ?? {},
        deduplication_key: this.createDeduplicationKey(
          command.recipient_id.toHexString(),
          command.type,
          event.payload.source_type,
          event.payload.source_id
        ),
        occurred_at: command.created_at ?? event.occurred_at
      })),
      { session: options.session }
    )
    const result: NotificationEventHandlerResult = results.length
      ? { status: 'batch', results }
      : { status: 'suppressed', notification: null, reason: 'no_opted_in_follower' }
    if (options.deliver !== false) this.deliverResult(result)
    return result
  }

  private async persistIndividual(
    command: CreateNotificationCommand,
    sourceType: string,
    sourceId: string,
    occurredAt: Date,
    options: NotificationEventHandlerOptions
  ): Promise<NotificationMutationResult> {
    return this.repository.createIndividualNotification(
      {
        recipient_id: command.recipient_id,
        sender_id: command.sender_id,
        type: command.type,
        target_id: command.target_id,
        target_type: command.target_type,
        context: command.context ?? {},
        deduplication_key: this.createDeduplicationKey(
          command.recipient_id.toHexString(),
          command.type,
          sourceType,
          sourceId
        ),
        occurred_at: command.created_at ?? occurredAt
      },
      { session: options.session }
    )
  }

  private createDeduplicationKey(
    recipientId: string,
    type: NotificationType,
    sourceType: string,
    sourceId: string
  ): string {
    return [recipientId, type.toUpperCase(), sourceType, sourceId].join(':')
  }

  private deliverResult(result: NotificationEventHandlerResult): void {
    if (result.status === 'batch') {
      for (const mutation of result.results) this.deliverMutation(mutation)
      return
    }
    this.deliverMutation(result)
  }

  private deliverMutation(result: NotificationMutationResult): void {
    if (result.status === 'created' || result.status === 'updated' || result.status === 'context_updated') {
      this.deliveryService.deliverNew(result.notification)
    }
    if (result.status === 'created' || result.status === 'updated') {
      this.deliveryService.deliverUnreadCount(result.unread_state)
    }
    if (result.status === 'invalidated') {
      this.deliveryService.deliverRemoved(result.notification, result.unread_state)
      if (result.unread_state) this.deliveryService.deliverUnreadCount(result.unread_state)
    }
    if (result.status === 'aggregate_updated') this.deliveryService.deliverUpdated(result.notification)
    if (result.status === 'aggregate_removed') {
      this.deliveryService.deliverRemoved(result.notification, result.unread_state)
    }
  }
}
