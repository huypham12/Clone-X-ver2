import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Server } from 'socket.io'

const require = createRequire(import.meta.url)
const { databaseService } = require('../dist/config/database.service.js')
const { default: commandService } = require('../dist/modules/conversation/conversation-message-command.service.js')
const { default: readService } = require('../dist/modules/conversation/conversation-read.service.js')
const { default: deliveryService } = require('../dist/modules/conversation/conversation-message-delivery.service.js')
const { default: conversationService } = require('../dist/modules/conversation/conversation.service.js')
const { default: redisService } = require('../dist/config/redis.service.js')
const { setIO } = require('../dist/socket/socket-server.js')
const { notificationQueue } = require('../dist/queues/notification.queue.js')
const { connection } = require('../dist/config/redisConfig.js')

const actorId = new databaseService.ObjectId()
const receiverId = new databaseService.ObjectId()
const directConversationIds = [
  new databaseService.ObjectId(),
  new databaseService.ObjectId(),
  new databaseService.ObjectId()
]
const groupConversationId = new databaseService.ObjectId()
const groupMemberIds = [actorId, ...Array.from({ length: 499 }, () => new databaseService.ObjectId())]
const scopedConversationIds = [...directConversationIds, groupConversationId]
const clientPrefix = `phase-11-12:${randomUUID()}`
const socketServer = new Server()
setIO(socketServer)

const createDirectConversation = (conversationId) => ({
  _id: conversationId,
  user1_id: actorId,
  user2_id: receiverId,
  last_message_at: new Date(),
  last_message_preview: { sender_id: actorId, content: 'test', message_type: 'text' },
  last_message_overrides: [],
  hidden_by: [],
  pinned_by: [],
  muted_by: [],
  history_cleared_by: [],
  created_at: new Date(),
  updated_at: new Date()
})

const cleanup = async () => {
  const messages = await databaseService.messages
    .find({ conversation_id: { $in: scopedConversationIds } }, { projection: { _id: 1 } })
    .toArray()
  const messageIds = messages.map((message) => message._id)
  await Promise.all([
    databaseService.outboxEvents.deleteMany({ aggregate_type: 'MESSAGE', aggregate_id: { $in: messageIds } }),
    databaseService.messages.deleteMany({ conversation_id: { $in: scopedConversationIds } }),
    databaseService.conversationReadStates.deleteMany({ conversation_id: { $in: scopedConversationIds } }),
    databaseService.userMessageStates.deleteMany({ user_id: { $in: [receiverId, ...groupMemberIds] } }),
    databaseService.notifications.deleteMany({ target_id: { $in: scopedConversationIds } }),
    databaseService.notificationStates.deleteMany({ recipient_id: receiverId }),
    databaseService.directConversations.deleteMany({ _id: { $in: directConversationIds } }),
    databaseService.groupConversations.deleteOne({ _id: groupConversationId })
  ])
}

const send = (conversationId, clientMessageId) =>
  commandService.send({
    sender_id: actorId.toHexString(),
    conversation_id: conversationId.toHexString(),
    conversation_type: 'direct',
    content: 'message foundation verification',
    client_message_id: clientMessageId
  })

const main = async () => {
  await databaseService.connect()
  await databaseService.createConversationIndexes()
  await databaseService.createOutboxIndexes()
  await cleanup()
  try {
    await databaseService.directConversations.insertMany(directConversationIds.map(createDirectConversation))

    const duplicateKey = `${clientPrefix}:duplicate`
    const duplicateResults = await Promise.all([
      send(directConversationIds[0], duplicateKey),
      send(directConversationIds[0], duplicateKey),
      send(directConversationIds[0], duplicateKey)
    ])
    assert.equal(new Set(duplicateResults.map((result) => result.message._id.toHexString())).size, 1)
    assert.equal(duplicateResults.filter((result) => result.created).length, 1)

    const firstMessage = await databaseService.messages.findOne({
      sender_id: actorId,
      client_message_id: duplicateKey
    })
    assert(firstMessage)
    assert.equal(Object.hasOwn(firstMessage, 'read_by'), false)
    assert.equal(
      await databaseService.outboxEvents.countDocuments({
        type: 'MessageCreated',
        aggregate_id: firstMessage._id
      }),
      1
    )

    const batches = [33, 33, 33].map((count, conversationIndex) =>
      Promise.all(
        Array.from({ length: count }, (_, index) =>
          send(
            directConversationIds[conversationIndex],
            `${clientPrefix}:conversation-${conversationIndex}:message-${index}`
          )
        )
      )
    )
    await Promise.all(batches)

    const summaryAtHundred = await readService.getSummary(receiverId.toHexString())
    assert.equal(summaryAtHundred.unread_conversation_count, 3)
    assert.equal(summaryAtHundred.total_unread_message_count, 100)
    const receiverStates = await readService.getConversationStates(receiverId.toHexString(), directConversationIds)
    assert.equal(
      receiverStates.reduce((sum, state) => sum + state.unread_message_count, 0),
      100
    )

    const latestFirstConversationMessages = await databaseService.messages
      .find({ conversation_id: directConversationIds[0] }, { projection: { _id: 1 } })
      .sort({ _id: -1 })
      .limit(2)
      .toArray()
    assert.equal(latestFirstConversationMessages.length, 2)
    const partialReadResult = await readService.markRead(
      receiverId.toHexString(),
      directConversationIds[0].toHexString(),
      latestFirstConversationMessages[1]._id.toHexString()
    )
    assert.equal(partialReadResult.read_state.unread_message_count, 1)
    assert.equal(partialReadResult.summary.unread_conversation_count, 3)
    assert.equal(partialReadResult.summary.total_unread_message_count, 67)
    const readResult = await readService.markRead(
      receiverId.toHexString(),
      directConversationIds[0].toHexString(),
      latestFirstConversationMessages[0]._id.toHexString()
    )
    assert.equal(readResult.read_state.unread_message_count, 0)
    assert.equal(readResult.summary.unread_conversation_count, 2)
    assert.equal(readResult.summary.total_unread_message_count, 66)

    const forwardOperationId = `${clientPrefix}:forward`
    const forwardRuns = await Promise.all([
      commandService.forward({
        sender_id: actorId.toHexString(),
        origin_message_id: firstMessage._id.toHexString(),
        conversation_ids: [directConversationIds[1].toHexString(), directConversationIds[2].toHexString()],
        client_operation_id: forwardOperationId
      }),
      commandService.forward({
        sender_id: actorId.toHexString(),
        origin_message_id: firstMessage._id.toHexString(),
        conversation_ids: [directConversationIds[1].toHexString(), directConversationIds[2].toHexString()],
        client_operation_id: forwardOperationId
      }),
      commandService.forward({
        sender_id: actorId.toHexString(),
        origin_message_id: firstMessage._id.toHexString(),
        conversation_ids: [directConversationIds[1].toHexString(), directConversationIds[2].toHexString()],
        client_operation_id: forwardOperationId
      })
    ])
    const createdForwards = forwardRuns.flat().filter((result) => result.created)
    assert.equal(createdForwards.length, 2)
    assert.equal(
      await databaseService.messages.countDocuments({
        sender_id: actorId,
        client_message_id: { $in: directConversationIds.slice(1).map((id) => `${forwardOperationId}:${id}`) }
      }),
      2
    )
    assert(createdForwards.every((result) => result.message.origin_message_id?.equals(firstMessage._id)))
    assert(createdForwards.every((result) => result.message.is_forwarded === true))

    const canonicalForwardOperationId = `${clientPrefix}:canonical-forward`
    const canonicalForward = await commandService.forward({
      sender_id: actorId.toHexString(),
      origin_message_id: firstMessage._id.toHexString(),
      conversation_ids: [directConversationIds[1].toHexString(), directConversationIds[1].toHexString().toUpperCase()],
      client_operation_id: canonicalForwardOperationId
    })
    assert.equal(canonicalForward.length, 1)
    assert.equal(canonicalForward[0].created, true)
    assert.equal(
      await databaseService.messages.countDocuments({
        sender_id: actorId,
        client_message_id: `${canonicalForwardOperationId}:${directConversationIds[1].toHexString()}`
      }),
      1
    )
    await redisService.connect()
    await Promise.all(createdForwards.map((result) => deliveryService.deliver(result)))
    for (const conversationId of directConversationIds.slice(1)) {
      const cacheKey = `chat:messages:${conversationId.toHexString()}`
      const cachedValues = await redisService.clientInstance.zRange(cacheKey, 0, -1)
      assert(cachedValues.length > 0)
      const cachedMessage = JSON.parse(cachedValues.at(-1))
      assert.equal(cachedMessage.conversation_id, conversationId.toHexString())
      assert(Object.hasOwn(cachedMessage, 'sender_info'))
      assert(Object.hasOwn(cachedMessage, 'reply_to'))
      const conversation = await databaseService.directConversations.findOne({ _id: conversationId })
      assert(conversation)
      assert.equal(conversation.last_message_preview.message_id.toHexString(), cachedMessage._id)
    }

    await databaseService.groupConversations.insertOne({
      _id: groupConversationId,
      name: 'phase read-state max group',
      members: groupMemberIds.map((userId, index) => ({
        user_id: userId,
        role: index === 0 ? 'admin' : 'member',
        joined_at: new Date()
      })),
      created_by: actorId,
      admin_only_messaging: false,
      last_message_at: new Date(),
      last_message_preview: { sender_id: actorId, content: 'test', message_type: 'text' },
      last_message_overrides: [],
      hidden_by: [],
      pinned_by: [],
      muted_by: [],
      history_cleared_by: [],
      created_at: new Date(),
      updated_at: new Date()
    })
    const groupResult = await commandService.send({
      sender_id: actorId.toHexString(),
      conversation_id: groupConversationId.toHexString(),
      conversation_type: 'group',
      content: 'max group bulk unread verification',
      client_message_id: `${clientPrefix}:max-group`
    })
    assert.equal(groupResult.read_mutations.length, 499)
    assert.equal(
      await databaseService.conversationReadStates.countDocuments({
        conversation_id: groupConversationId,
        unread_message_count: 1
      }),
      499
    )

    const removedMemberId = groupMemberIds.at(-1)
    assert(removedMemberId)
    const removedSummaryBefore = await readService.getSummary(removedMemberId.toHexString())
    assert.equal(removedSummaryBefore.unread_conversation_count, 1)
    assert.equal(removedSummaryBefore.total_unread_message_count, 1)
    await conversationService.removeGroupMember(
      actorId.toHexString(),
      groupConversationId.toHexString(),
      removedMemberId.toHexString()
    )
    assert.equal(
      await databaseService.conversationReadStates.countDocuments({
        conversation_id: groupConversationId,
        user_id: removedMemberId
      }),
      0
    )
    const removedSummaryAfter = await readService.getSummary(removedMemberId.toHexString())
    assert.equal(removedSummaryAfter.unread_conversation_count, 0)
    assert.equal(removedSummaryAfter.total_unread_message_count, 0)

    const rejoinedAt = new Date()
    await databaseService.groupConversations.updateOne(
      { _id: groupConversationId, 'members.user_id': { $ne: removedMemberId } },
      {
        $push: {
          members: {
            user_id: removedMemberId,
            role: 'member',
            joined_at: rejoinedAt
          }
        }
      }
    )
    await readService.initializeMembership(
      groupConversationId,
      'group',
      [removedMemberId],
      groupResult.message._id,
      rejoinedAt
    )
    const rejoinedState = await databaseService.conversationReadStates.findOne({
      conversation_id: groupConversationId,
      user_id: removedMemberId
    })
    assert(rejoinedState)
    assert.equal(rejoinedState.unread_message_count, 0)
    assert(rejoinedState.last_read_message_id?.equals(groupResult.message._id))

    const inboundGroupMessage = await commandService.send({
      sender_id: groupMemberIds[1].toHexString(),
      conversation_id: groupConversationId.toHexString(),
      conversation_type: 'group',
      content: 'history clear unread verification',
      client_message_id: `${clientPrefix}:history-clear`
    })
    assert.equal(inboundGroupMessage.created, true)
    const actorSummaryBeforeClear = await readService.getSummary(actorId.toHexString())
    assert.equal(actorSummaryBeforeClear.unread_conversation_count, 1)
    await conversationService.clearConversationHistory(actorId.toHexString(), groupConversationId.toHexString())
    const actorSummaryAfterClear = await readService.getSummary(actorId.toHexString())
    assert.equal(actorSummaryAfterClear.unread_conversation_count, 0)
    assert.equal(actorSummaryAfterClear.total_unread_message_count, 0)

    const indexes = await databaseService.messages.listIndexes().toArray()
    assert(indexes.some((index) => index.name === 'message_sender_client_id_unique' && index.unique === true))
    console.log('Message foundation runtime verification passed', {
      duplicate_messages: 1,
      direct_unread_conversations: summaryAtHundred.unread_conversation_count,
      direct_unread_messages: summaryAtHundred.total_unread_message_count,
      max_group_members: groupMemberIds.length,
      max_group_recipient_states: groupResult.read_mutations.length,
      idempotent_forward_targets: createdForwards.length,
      canonical_forward_targets: canonicalForward.length,
      removed_member_unread_cleanup: removedSummaryAfter.total_unread_message_count,
      history_clear_unread: actorSummaryAfterClear.total_unread_message_count
    })
  } finally {
    await cleanup()
    await Promise.allSettled(
      scopedConversationIds.map((conversationId) => redisService.del(`chat:messages:${conversationId.toHexString()}`))
    )
    await redisService.disconnect().catch(() => undefined)
    await notificationQueue.close().catch(() => undefined)
    await connection.quit().catch(() => undefined)
    await databaseService.disconnect()
  }
}

await main()
