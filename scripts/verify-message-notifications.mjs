import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Server } from 'socket.io'

process.env.NOTIFICATION_OUTBOX_ENABLED = 'true'
process.env.NOTIFICATION_MESSAGE_DIRECTED_ENABLED = 'true'
process.env.NOTIFICATION_MESSAGE_REACTION_ENABLED = 'true'

const require = createRequire(import.meta.url)
const { databaseService } = require('../dist/config/database.service.js')
const { default: commandService } = require('../dist/modules/conversation/conversation-message-command.service.js')
const { default: deliveryService } = require('../dist/modules/conversation/conversation-message-delivery.service.js')
const { default: conversationService } = require('../dist/modules/conversation/conversation.service.js')
const { NotificationEventHandler } = require('../dist/modules/notification/notification-event.handler.js')
const { setIO } = require('../dist/socket/socket-server.js')
const { notificationQueue } = require('../dist/queues/notification.queue.js')
const { connection } = require('../dist/config/redisConfig.js')

const ownerId = new databaseService.ObjectId()
const senderId = new databaseService.ObjectId()
const mentionedId = new databaseService.ObjectId()
const ordinaryMemberId = new databaseService.ObjectId()
const reactionActorIds = Array.from({ length: 20 }, () => new databaseService.ObjectId())
const allUserIds = [ownerId, senderId, mentionedId, ordinaryMemberId, ...reactionActorIds]
const conversationId = new databaseService.ObjectId()
const clientPrefix = `phase-13-14:${randomUUID()}`
const handler = new NotificationEventHandler()
setIO(new Server())

const processEvent = async (event) => {
  const session = databaseService.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await handler.handle(
        {
          event_id: event.event_id,
          type: event.type,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          actor_id: event.actor_id,
          payload: event.payload,
          occurred_at: event.occurred_at
        },
        { session, deliver: false }
      )
    })
    return result
  } finally {
    await session.endSession()
  }
}

const cleanup = async () => {
  const messages = await databaseService.messages
    .find({ conversation_id: conversationId }, { projection: { _id: 1 } })
    .toArray()
  const messageIds = messages.map((message) => message._id)
  const notifications = await databaseService.notifications
    .find(
      { $or: [{ recipient_id: { $in: allUserIds } }, { target_id: { $in: messageIds } }] },
      { projection: { _id: 1 } }
    )
    .toArray()
  const notificationIds = notifications.map((notification) => notification._id)
  await Promise.all([
    databaseService.notificationActors.deleteMany({ notification_id: { $in: notificationIds } }),
    databaseService.notifications.deleteMany({ _id: { $in: notificationIds } }),
    databaseService.notificationStates.deleteMany({ recipient_id: { $in: allUserIds } }),
    databaseService.outboxEvents.deleteMany({ aggregate_type: 'MESSAGE', aggregate_id: { $in: messageIds } }),
    databaseService.conversationReadStates.deleteMany({ conversation_id: conversationId }),
    databaseService.userMessageStates.deleteMany({ user_id: { $in: allUserIds } }),
    databaseService.messages.deleteMany({ conversation_id: conversationId }),
    databaseService.groupConversations.deleteOne({ _id: conversationId }),
    databaseService.users.deleteMany({ _id: { $in: allUserIds } })
  ])
}

const send = (actorId, content, options = {}) =>
  commandService.send({
    sender_id: actorId.toHexString(),
    conversation_id: conversationId.toHexString(),
    conversation_type: 'group',
    content,
    client_message_id: `${clientPrefix}:${randomUUID()}`,
    ...options
  })

const main = async () => {
  await databaseService.connect()
  await Promise.all([
    databaseService.createConversationIndexes(),
    databaseService.createNotificationIndexes(),
    databaseService.createOutboxIndexes()
  ])
  await cleanup()
  try {
    await databaseService.users.insertMany(
      allUserIds.map((id, index) => ({
        _id: id,
        username: index === 2 ? 'mention_target' : `phase_user_${index}`
      }))
    )
    await databaseService.groupConversations.insertOne({
      _id: conversationId,
      name: 'phase 13-14 verification',
      members: allUserIds.map((userId, index) => ({
        user_id: userId,
        role: index === 0 ? 'admin' : 'member',
        joined_at: new Date()
      })),
      created_by: ownerId,
      admin_only_messaging: false,
      last_message_at: new Date(),
      last_message_preview: { sender_id: ownerId, content: '', message_type: 'text' },
      last_message_overrides: [],
      hidden_by: [],
      pinned_by: [],
      muted_by: [{ user_id: mentionedId, until: null }],
      history_cleared_by: [],
      created_at: new Date(),
      updated_at: new Date()
    })

    const replyTarget = await send(mentionedId, 'reply target')
    const directedClientId = `${clientPrefix}:directed`
    const ignoredNonMemberId = new databaseService.ObjectId()
    const directed = await send(senderId, 'hello @mention_target @mention_target', {
      reply_to_message_id: replyTarget.message._id.toHexString(),
      mention_user_ids: [mentionedId.toHexString(), mentionedId.toHexString(), ignoredNonMemberId.toHexString()],
      client_message_id: directedClientId
    })
    assert.deepEqual(directed.message.mention_user_ids.map((id) => id.toHexString()), [mentionedId.toHexString()])
    await assert.rejects(
      commandService.send({
        sender_id: senderId.toHexString(),
        conversation_id: conversationId.toHexString(),
        conversation_type: 'group',
        content: 'hello @mention_target @mention_target',
        reply_to_message_id: replyTarget.message._id.toHexString(),
        mention_user_ids: [ordinaryMemberId.toHexString()],
        client_message_id: directedClientId
      }),
      (error) => error?.code === 'CONFLICT' || error?.statusCode === 409
    )
    await deliveryService.deliver(directed)
    const directedEvent = await databaseService.outboxEvents.findOne({
      type: 'MessageCreated',
      aggregate_id: directed.message._id
    })
    assert(directedEvent)
    await processEvent(directedEvent)
    await processEvent(directedEvent)
    assert.equal(
      await databaseService.notifications.countDocuments({
        recipient_id: mentionedId,
        target_id: directed.message._id,
        type: 'message_mention',
        invalidated_at: null
      }),
      1
    )
    assert.equal(
      await databaseService.notifications.countDocuments({
        target_id: directed.message._id,
        type: { $in: ['message_reply', 'message'] }
      }),
      0
    )
    assert.equal(
      await databaseService.notifications.countDocuments({
        recipient_id: ordinaryMemberId,
        target_id: directed.message._id
      }),
      0
    )

    const threeEmojiMessage = await send(ownerId, 'three emoji target')
    await conversationService.reactMessage(senderId.toHexString(), threeEmojiMessage.message._id.toHexString(), '👍')
    await conversationService.reactMessage(senderId.toHexString(), threeEmojiMessage.message._id.toHexString(), '❤️')
    await conversationService.reactMessage(senderId.toHexString(), threeEmojiMessage.message._id.toHexString(), '😂')
    await conversationService.reactMessage(senderId.toHexString(), threeEmojiMessage.message._id.toHexString(), '😂')
    const threeEmojiEvents = await databaseService.outboxEvents
      .find({ type: 'MessageReactionChanged', aggregate_id: threeEmojiMessage.message._id })
      .sort({ occurred_at: 1, _id: 1 })
      .toArray()
    assert.equal(threeEmojiEvents.length, 3)
    await Promise.all(threeEmojiEvents.map(processEvent))
    const threeEmojiAggregate = await databaseService.notifications.findOne({
      recipient_id: ownerId,
      target_id: threeEmojiMessage.message._id,
      type: 'message_reaction',
      aggregation_active: true
    })
    assert(threeEmojiAggregate)
    assert.equal(threeEmojiAggregate.actor_count, 1)
    assert.equal(threeEmojiAggregate.context?.emoji, '😂')

    const visibilityRaceMessage = await send(mentionedId, 'owner visibility race target')
    await conversationService.reactMessage(
      senderId.toHexString(),
      visibilityRaceMessage.message._id.toHexString(),
      '👍'
    )
    const visibilityChangedEvent = await databaseService.outboxEvents.findOne({
      type: 'MessageReactionChanged',
      aggregate_id: visibilityRaceMessage.message._id
    })
    assert(visibilityChangedEvent)
    await processEvent(visibilityChangedEvent)
    const visibilityAggregate = await databaseService.notifications.findOne({
      recipient_id: mentionedId,
      target_id: visibilityRaceMessage.message._id,
      type: 'message_reaction',
      aggregation_active: true
    })
    assert(visibilityAggregate)
    await conversationService.unreactMessage(
      senderId.toHexString(),
      visibilityRaceMessage.message._id.toHexString()
    )
    await conversationService.deleteMessage(
      mentionedId.toHexString(),
      visibilityRaceMessage.message._id.toHexString()
    )
    const visibilityRemovedEvent = await databaseService.outboxEvents.findOne({
      type: 'MessageReactionRemoved',
      aggregate_id: visibilityRaceMessage.message._id
    })
    assert(visibilityRemovedEvent)
    await processEvent(visibilityRemovedEvent)
    const visibilityAggregateAfterRemove = await databaseService.notifications.findOne({
      _id: visibilityAggregate._id
    })
    assert(visibilityAggregateAfterRemove)
    assert.equal(visibilityAggregateAfterRemove.aggregation_active, false)
    assert.equal(visibilityAggregateAfterRemove.actor_count, 0)

    const concurrentMessage = await send(ownerId, 'concurrent reaction target')
    await Promise.all(
      reactionActorIds.map((actorId) =>
        conversationService.reactMessage(actorId.toHexString(), concurrentMessage.message._id.toHexString(), '👍')
      )
    )
    const addEvents = await databaseService.outboxEvents
      .find({ type: 'MessageReactionChanged', aggregate_id: concurrentMessage.message._id })
      .toArray()
    assert.equal(addEvents.length, 20)
    await Promise.all(addEvents.map(processEvent))
    const aggregate = await databaseService.notifications.findOne({
      recipient_id: ownerId,
      target_id: concurrentMessage.message._id,
      type: 'message_reaction',
      aggregation_active: true
    })
    assert(aggregate)
    assert.equal(aggregate.actor_count, 20)
    const ownerState = await databaseService.notificationStates.findOne({ recipient_id: ownerId })
    assert(ownerState)
    assert.equal(ownerState.unread_count, 2)

    await Promise.all(
      reactionActorIds.map((actorId) =>
        conversationService.unreactMessage(actorId.toHexString(), concurrentMessage.message._id.toHexString())
      )
    )
    const removeEvents = await databaseService.outboxEvents
      .find({ type: 'MessageReactionRemoved', aggregate_id: concurrentMessage.message._id })
      .toArray()
    assert.equal(removeEvents.length, 20)
    await Promise.all(removeEvents.map(processEvent))
    await conversationService.unreactMessage(
      reactionActorIds[0].toHexString(),
      concurrentMessage.message._id.toHexString()
    )
    assert.equal(
      await databaseService.outboxEvents.countDocuments({
        type: 'MessageReactionRemoved',
        aggregate_id: concurrentMessage.message._id
      }),
      20
    )
    const removedAggregate = await databaseService.notifications.findOne({ _id: aggregate._id })
    assert(removedAggregate)
    assert.equal(removedAggregate.aggregation_active, false)
    assert.equal(removedAggregate.actor_count, 0)
    const ownerStateAfterRemove = await databaseService.notificationStates.findOne({ recipient_id: ownerId })
    assert(ownerStateAfterRemove)
    assert.equal(ownerStateAfterRemove.unread_count, 1)

    console.log('Message notification runtime verification passed', {
      directed_precedence_and_retry: true,
      emoji_change_actor_count: threeEmojiAggregate.actor_count,
      concurrent_actor_count: aggregate.actor_count,
      last_remove_invalidated: removedAggregate.aggregation_active === false
    })
  } finally {
    await cleanup()
    await notificationQueue.close().catch(() => undefined)
    await connection.quit().catch(() => undefined)
    await databaseService.disconnect()
  }
}

await main()
