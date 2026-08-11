import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import jwt from 'jsonwebtoken'
import databaseModule from '../dist/config/database.service.js'
import envModule from '../dist/config/getEnvConfig.js'
import enumModule from '../dist/constants/enums/index.js'
import notificationRouteModule from '../dist/modules/notification/notification.route.js'
import notificationServiceModule from '../dist/modules/notification/notification.service.js'
import errorHandlerModule from '../dist/middleware/error-handler.middleware.js'
import socketModule from '../dist/socket/index.js'
import redisModule from '../dist/config/redis.service.js'

const { databaseService, default: DatabaseService } = databaseModule
const { envConfig, isProduction } = envModule
const { NotificationType, TokenType, UserVerifyStatus } = enumModule
const notificationRouter = notificationRouteModule.default
const notificationService = notificationServiceModule.default
const { errorHandler } = errorHandlerModule
const { initSocket } = socketModule
const redisService = redisModule.default
const scriptPath = fileURLToPath(import.meta.url)
const bootstrapChildMode = process.argv.includes('--bootstrap-child')

const assertSafeTestEnvironment = () => {
  const explicitlyAllowed = process.env.NOTIFICATION_FOUNDATION_ALLOW_MUTATION === 'true'
  const hasTestDatabaseName = /(^|[-_])(test|testing)([-_]|$)/i.test(envConfig.db.name)
  const usesProductionConfig = isProduction

  if (!explicitlyAllowed || !hasTestDatabaseName || usesProductionConfig) {
    throw new Error(
      'Notification foundation tests require an explicitly enabled test database: ' +
        'set NOTIFICATION_FOUNDATION_ALLOW_MUTATION=true, use a DB_NAME containing test/testing, and do not use --env=production'
    )
  }
}

const runBootstrapChild = () =>
  new Promise((resolve, reject) => {
    const environmentArgument = process.argv.find((argument) => argument.startsWith('--env='))
    const childArguments = [scriptPath, '--bootstrap-child', ...(environmentArgument ? [environmentArgument] : [])]
    const child = spawn(process.execPath, childArguments, {
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let errorOutput = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }
      reject(new Error(`Bootstrap child exited with code ${exitCode}: ${errorOutput.trim()}`))
    })
  })

const runBootstrapOnly = async () => {
  await databaseService.connect()
  try {
    await databaseService.createConversationIndexes()
    await databaseService.createNotificationIndexes()
  } finally {
    await databaseService.disconnect()
  }
}

const openSocket = (url, token) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Socket.IO handshake timed out'))
    }, 15_000)

    socket.addEventListener('message', (event) => {
      const message = String(event.data)
      if (message.startsWith('0')) {
        socket.send(`40${JSON.stringify({ token })}`)
      } else if (message.startsWith('40')) {
        clearTimeout(timeout)
        resolve(socket)
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Socket.IO WebSocket connection failed'))
    })
  })

const waitForSocketEvent = (socket, eventName) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', handleMessage)
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, 10_000)
    const handleMessage = (event) => {
      const message = String(event.data)
      if (!message.startsWith('42')) return
      const [receivedEventName, payload] = JSON.parse(message.slice(2))
      if (receivedEventName !== eventName) return
      clearTimeout(timeout)
      socket.removeEventListener('message', handleMessage)
      resolve(payload)
    }
    socket.addEventListener('message', handleMessage)
  })

const requestJson = async (baseUrl, token, path, method = 'GET') => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` }
  })
  return { status: response.status, body: await response.json() }
}

const waitForLastSeenSync = async (userId) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await redisService.clientInstance.hGet('user_last_seen', userId)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for socket disconnect state to settle')
}

const main = async () => {
  const recipientId = new databaseService.ObjectId()
  const emptyRecipientId = new databaseService.ObjectId()
  const foreignRecipientId = new databaseService.ObjectId()
  const friendsCacheKey = `friends:${recipientId}`
  let httpServer
  let io
  let databaseConnected = false
  let redisConnected = false
  let sockets = []
  let testError
  const cleanupErrors = []
  const attemptCleanup = async (operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  try {
    await Promise.all([runBootstrapChild(), runBootstrapChild()])
    await databaseService.connect()
    databaseConnected = true
    await databaseService.createNotificationIndexes()
    await databaseService.createNotificationIndexes()

    const notificationIndexes = await databaseService.notifications.listIndexes().toArray()
    const indexNames = new Set(notificationIndexes.map((index) => index.name))
    const hasIndexKey = (expectedKey) =>
      notificationIndexes.some(
        (index) =>
          Object.keys(index.key).length === Object.keys(expectedKey).length &&
          Object.entries(expectedKey).every(([field, direction]) => index.key[field] === direction)
      )
    assert(indexNames.has('recipient_id_1_created_at_-1'))
    assert(indexNames.has('recipient_id_1_is_read_1'))
    assert(hasIndexKey({ recipient_id: 1, created_at: -1, _id: -1 }))
    assert(hasIndexKey({ deduplication_key: 1 }))
    assert(hasIndexKey({ target_type: 1, target_id: 1 }))
    assert.equal(DatabaseService.getInstance(), databaseService)
    assert.equal(new Set(Array.from({ length: 100 }, () => DatabaseService.getInstance())).size, 1)

    const createdAt = new Date()
    const notificationIds = Array.from({ length: 10 }, (_, index) => new databaseService.ObjectId())
    await databaseService.notifications.insertMany(
      notificationIds.map((notificationId, index) => ({
        _id: notificationId,
        recipient_id: recipientId,
        sender_id: null,
        type: 'system',
        target_id: null,
        is_read: false,
        created_at: new Date(createdAt.getTime() + index)
      }))
    )

    const foreignNotificationId = new databaseService.ObjectId()
    await databaseService.notifications.insertOne({
      _id: foreignNotificationId,
      recipient_id: foreignRecipientId,
      sender_id: null,
      type: 'system',
      target_id: null,
      is_read: false,
      created_at: new Date(createdAt.getTime() + 20)
    })

    const token = jwt.sign(
      {
        user_id: recipientId.toString(),
        verify: UserVerifyStatus.Verified,
        token_type: TokenType.AccessToken
      },
      envConfig.secrets.jwt.access,
      { algorithm: 'HS256', expiresIn: '10m' }
    )
    const emptyRecipientToken = jwt.sign(
      {
        user_id: emptyRecipientId.toString(),
        verify: UserVerifyStatus.Verified,
        token_type: TokenType.AccessToken
      },
      envConfig.secrets.jwt.access,
      { algorithm: 'HS256', expiresIn: '10m' }
    )

    const app = express()
    app.use(express.json())
    app.use('/api/notifications', notificationRouter)
    app.use(errorHandler)
    httpServer = createServer(app)

    await redisService.connect()
    redisConnected = true
    await redisService.set(friendsCacheKey, [], 300)
    io = initSocket(httpServer, databaseService)
    httpServer.listen(0, '127.0.0.1')
    await once(httpServer, 'listening')
    const address = httpServer.address()
    assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const emptyPage = await requestJson(baseUrl, emptyRecipientToken, '/api/notifications')
    assert.equal(emptyPage.status, 200)
    assert.deepEqual(emptyPage.body.data.notifications, [])
    assert.equal(emptyPage.body.data.has_next_page, false)
    assert.equal(emptyPage.body.data.next_cursor, null)

    const exactPage = await requestJson(baseUrl, token, '/api/notifications')
    assert.equal(exactPage.status, 200)
    assert.equal(exactPage.body.data.notifications.length, 10)
    assert.equal(exactPage.body.data.has_next_page, false)
    assert.equal(exactPage.body.data.next_cursor, null)

    const eleventhNotificationId = new databaseService.ObjectId()
    notificationIds.push(eleventhNotificationId)
    await databaseService.notifications.insertOne({
      _id: eleventhNotificationId,
      recipient_id: recipientId,
      sender_id: null,
      type: 'system',
      target_id: null,
      is_read: false,
      created_at: new Date(createdAt.getTime() + 30)
    })

    const firstPage = await requestJson(baseUrl, token, '/api/notifications?limit=10')
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.body.data.notifications.length, 10)
    assert.equal(firstPage.body.data.has_next_page, true)
    assert.equal(typeof firstPage.body.data.next_cursor, 'string')
    assert.doesNotMatch(firstPage.body.data.next_cursor, /^[a-f\d]{24}$/i)

    const secondPage = await requestJson(
      baseUrl,
      token,
      `/api/notifications?limit=10&cursor=${firstPage.body.data.next_cursor}`
    )
    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.body.data.notifications.length, 1)
    assert.equal(secondPage.body.data.has_next_page, false)

    const legacyCursorPage = await requestJson(
      baseUrl,
      token,
      `/api/notifications?limit=10&cursor=${firstPage.body.data.notifications.at(-1)._id}`
    )
    assert.equal(legacyCursorPage.status, 200)
    assert.equal(legacyCursorPage.body.data.notifications.length, 1)

    const limitOne = await requestJson(baseUrl, token, '/api/notifications?limit=1')
    assert.equal(limitOne.status, 200)
    assert.equal(limitOne.body.data.notifications.length, 1)
    assert.equal(limitOne.body.data.has_next_page, true)

    const limitHundred = await requestJson(baseUrl, token, '/api/notifications?limit=100')
    assert.equal(limitHundred.status, 200)
    assert.equal(limitHundred.body.data.notifications.length, 11)
    assert.equal(limitHundred.body.data.has_next_page, false)

    assert.equal((await requestJson(baseUrl, token, '/api/notifications?limit=101')).status, 400)
    assert.equal((await requestJson(baseUrl, token, '/api/notifications?cursor=invalid')).status, 400)
    assert.equal((await requestJson(baseUrl, token, '/api/notifications/not-an-id/read', 'POST')).status, 400)

    const missingId = new databaseService.ObjectId().toString()
    assert.equal((await requestJson(baseUrl, token, `/api/notifications/${missingId}/read`, 'POST')).status, 404)
    assert.equal(
      (await requestJson(baseUrl, token, `/api/notifications/${foreignNotificationId}/read`, 'POST')).status,
      404
    )
    assert.equal((await databaseService.notifications.findOne({ _id: foreignNotificationId })).is_read, false)

    const ownNotificationId = notificationIds[0].toString()
    const firstMarkRead = await requestJson(baseUrl, token, `/api/notifications/${ownNotificationId}/read`, 'POST')
    const secondMarkRead = await requestJson(baseUrl, token, `/api/notifications/${ownNotificationId}/read`, 'POST')
    assert.equal(firstMarkRead.status, 200)
    assert.deepEqual(firstMarkRead.body.data, { success: true })
    assert.equal(secondMarkRead.status, 200)
    assert.deepEqual(secondMarkRead.body.data, { success: true })

    const firstReadAll = await requestJson(baseUrl, token, '/api/notifications/read-all', 'POST')
    const secondReadAll = await requestJson(baseUrl, token, '/api/notifications/read-all', 'POST')
    assert.equal(firstReadAll.status, 200)
    assert.equal(firstReadAll.body.data.updatedCount, 10)
    assert.equal(secondReadAll.status, 200)
    assert.equal(secondReadAll.body.data.updatedCount, 0)

    const socketUrl = `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`
    sockets = await Promise.all(Array.from({ length: 100 }, () => openSocket(socketUrl, token)))
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal((await io.in(recipientId.toString()).allSockets()).size, 100)

    const targetId = new databaseService.ObjectId()
    const notificationEventPromise = waitForSocketEvent(sockets[0], '@notification:new')
    const createdNotification = await notificationService.createNotification(
      recipientId.toString(),
      foreignRecipientId.toString(),
      NotificationType.Follow,
      targetId.toString()
    )
    const notificationEvent = await notificationEventPromise
    assert(createdNotification)
    assert.equal(notificationEvent._id, createdNotification._id.toString())
    assert.equal(notificationEvent.recipient_id, recipientId.toString())
    assert.equal(notificationEvent.sender_id, foreignRecipientId.toString())
    assert.equal(notificationEvent.type, NotificationType.Follow)
    assert.equal(notificationEvent.target_id, targetId.toString())
    assert.equal(notificationEvent.is_read, false)
    assert.equal(typeof notificationEvent.created_at, 'string')

    console.log('Notification foundation integration gate passed')
  } catch (error) {
    testError = error
  } finally {
    for (const socket of sockets) socket.close()
    if (io) {
      await attemptCleanup(() => new Promise((resolve) => io.close(resolve)))
    } else if (httpServer?.listening) {
      await attemptCleanup(() => new Promise((resolve) => httpServer.close(resolve)))
    }
    if (redisConnected && sockets.length > 0) {
      await attemptCleanup(() => waitForLastSeenSync(recipientId.toString()))
    }
    if (redisConnected) {
      await attemptCleanup(() => redisService.del(friendsCacheKey))
      await attemptCleanup(() => redisService.clientInstance.hDel('user_last_seen', recipientId.toString()))
      await attemptCleanup(() => redisService.disconnect())
    }
    if (databaseConnected) {
      await attemptCleanup(() =>
        databaseService.notifications.deleteMany({
          recipient_id: { $in: [recipientId, foreignRecipientId] }
        })
      )
      await attemptCleanup(() => databaseService.disconnect())
    }
  }

  const failures = [...(testError ? [testError] : []), ...cleanupErrors]
  if (failures.length > 0) throw new AggregateError(failures, 'Notification foundation integration gate failed')
}

assertSafeTestEnvironment()
const execution = bootstrapChildMode ? runBootstrapOnly() : main()
execution.catch((error) => {
  console.error(error)
  process.exitCode = 1
})
