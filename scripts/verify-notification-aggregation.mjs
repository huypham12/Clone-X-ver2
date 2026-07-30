import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { databaseService } = require('../dist/config/database.service.js')
const { NotificationType, NotificationTargetType } = require('../dist/constants/enums/index.js')
const { NotificationAggregationService } = require(
  '../dist/modules/notification/notification-aggregation.service.js'
)
const { NotificationRepository } = require('../dist/modules/notification/notification.repository.js')
const { NotificationUnreadService } = require('../dist/modules/notification/notification-unread.service.js')

const recipientId = new databaseService.ObjectId()
const targetId = new databaseService.ObjectId()
const aggregationKey = `${recipientId.toHexString()}:LIKE:${targetId.toHexString()}`
const actorIds = Array.from({ length: 100 }, () => new databaseService.ObjectId())
const aggregationService = new NotificationAggregationService(databaseService)
const repository = new NotificationRepository(databaseService)
const unreadService = new NotificationUnreadService(databaseService)

const inTransaction = async (operation) => {
  const session = databaseService.startSession()
  try {
    let result
    await session.withTransaction(async () => {
      result = await operation(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}

const addActor = (actorId, sourceKey) =>
  inTransaction((session) =>
    aggregationService.addActor(
      {
        recipient_id: recipientId,
        actor_id: actorId,
        type: NotificationType.Like,
        target_id: targetId,
        target_type: NotificationTargetType.Tweet,
        aggregation_key: aggregationKey,
        source_key: sourceKey,
        event_id: `phase-10:${randomUUID()}`,
        context: {},
        occurred_at: new Date()
      },
      { session }
    )
  )

const removeActor = (sourceKey) =>
  inTransaction((session) => aggregationService.removeActor(sourceKey, new Date(), { session }))

const cleanup = async () => {
  const notificationIds = await databaseService.notifications
    .find({ recipient_id: recipientId }, { projection: { _id: 1 } })
    .toArray()
  await databaseService.notificationActors.deleteMany({
    notification_id: { $in: notificationIds.map((notification) => notification._id) }
  })
  await databaseService.notifications.deleteMany({ recipient_id: recipientId })
  await databaseService.notificationStates.deleteOne({ recipient_id: recipientId })
}

const main = async () => {
  await databaseService.connect()
  await databaseService.createNotificationIndexes()
  await cleanup()
  try {
    const sourceKeys = actorIds.map((actorId) => `phase-10:${targetId.toHexString()}:${actorId.toHexString()}`)
    await Promise.all(actorIds.map((actorId, index) => addActor(actorId, sourceKeys[index])))

    const active = await databaseService.notifications.findOne({
      recipient_id: recipientId,
      aggregation_key: aggregationKey,
      aggregation_active: true,
      invalidated_at: null
    })
    assert(active)
    assert.equal(active.actor_count, 100)
    assert.equal(active.actor_ids_preview?.length, 3)
    assert.equal(
      await databaseService.notificationActors.countDocuments({ notification_id: active._id }),
      100
    )
    assert.equal((await unreadService.get(recipientId)).unread_count, 1)

    await removeActor(sourceKeys[0])
    await removeActor(sourceKeys[0])
    const afterRepeatedRemove = await databaseService.notifications.findOne({ _id: active._id })
    assert(afterRepeatedRemove)
    assert.equal(afterRepeatedRemove.actor_count, 99)
    assert.equal((await unreadService.get(recipientId)).unread_count, 1)

    await inTransaction((session) => repository.markAsRead(recipientId, active._id, new Date(), { session }))
    assert.equal((await unreadService.get(recipientId)).unread_count, 0)

    const nextActorId = new databaseService.ObjectId()
    await addActor(nextActorId, `phase-10:${targetId.toHexString()}:${nextActorId.toHexString()}`)
    const windows = await databaseService.notifications
      .find({ recipient_id: recipientId, aggregation_key: aggregationKey, invalidated_at: null })
      .sort({ created_at: 1 })
      .toArray()
    assert.equal(windows.length, 2)
    assert.equal(windows.filter((notification) => notification.aggregation_active).length, 1)
    assert.equal(windows.at(-1)?.actor_count, 1)
    assert.equal((await unreadService.get(recipientId)).unread_count, 1)

    console.log('Notification aggregation runtime gate passed', {
      concurrent_actor_count: active.actor_count,
      actor_count_after_repeated_remove: afterRepeatedRemove.actor_count,
      aggregate_windows_after_read: windows.length,
      unread_count: 1
    })
  } finally {
    await cleanup()
    await databaseService.disconnect()
  }
}

await main()
