import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const collectTypeScriptFiles = (directory) => {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(absolutePath))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolutePath)
  }
  return files
}

const relative = (absolutePath) => path.relative(root, absolutePath).replaceAll('\\', '/')
const sourceFiles = collectTypeScriptFiles(path.join(root, 'src'))
const sourceByPath = new Map(sourceFiles.map((file) => [relative(file), fs.readFileSync(file, 'utf8')]))

const findMatches = (pattern, allowedPaths = new Set()) =>
  [...sourceByPath.entries()]
    .filter(([file]) => !allowedPaths.has(file))
    .flatMap(([file, source]) => (pattern.test(source) ? [file] : []))

const directNotificationCallers = findMatches(
  /\.createNotification\s*\(/,
  new Set(['src/modules/notification/notification.service.ts'])
)
assert.deepEqual(directNotificationCallers, [], `Direct notification callers: ${directNotificationCallers.join(', ')}`)

const messageWriters = findMatches(/new\s+Message\s*\(/, new Set(['src/modules/conversation/conversation-message-command.service.ts']))
assert.deepEqual(messageWriters, [], `Message writers outside command service: ${messageWriters.join(', ')}`)

const readByRuntimeUsers = findMatches(
  /\bread_by\b/,
  new Set(['src/schemas/Message.schema.ts', 'src/config/database.service.ts'])
)
assert.deepEqual(readByRuntimeUsers, [], `Runtime read_by usage: ${readByRuntimeUsers.join(', ')}`)

const notificationModuleImportsBusiness = [...sourceByPath.entries()]
  .filter(([file]) => file.startsWith('src/modules/notification/'))
  .filter(([, source]) => /from\s+['"]~\/modules\/(user|tweet|conversation)\//.test(source))
  .map(([file]) => file)
assert.deepEqual(
  notificationModuleImportsBusiness,
  [],
  `Notification module imports business modules: ${notificationModuleImportsBusiness.join(', ')}`
)

const repositorySource = read('src/modules/notification/notification.repository.ts')
assert.doesNotMatch(repositorySource, /getIO|socket-server|NotificationDeliveryService/)
const deliverySource = read('src/modules/notification/notification-delivery.service.ts')
assert.doesNotMatch(deliverySource, /DatabaseService|notification\.repository|notification-policy|modules\/(user|tweet|conversation)/)
const policySource = read('src/modules/notification/notification-policy.service.ts')
assert.doesNotMatch(policySource, /notification\.repository|notification-delivery|socket-server|getIO/)

const configSource = read('src/config/getEnvConfig.ts')
const enabledByDefault = [
  'NOTIFICATION_OUTBOX_ENABLED',
  'NOTIFICATION_FOLLOW_OUTBOX_ENABLED',
  'NOTIFICATION_TWEET_OUTBOX_ENABLED',
  'NOTIFICATION_SOCIAL_AGGREGATION_ENABLED',
  'NOTIFICATION_MESSAGE_DIRECTED_ENABLED',
  'NOTIFICATION_MESSAGE_REACTION_ENABLED',
  'NOTIFICATION_GROUP_MANAGEMENT_ENABLED',
  'NOTIFICATION_FOLLOWED_TWEET_ENABLED'
]
for (const flag of enabledByDefault) {
  assert.match(configSource, new RegExp(`getBooleanEnvVar\\('${flag}',\\s+true\\)`), `${flag} must default to true`)
}
assert.doesNotMatch(configSource, /NOTIFICATION_UNREAD_STATE_ENABLED|notificationUnreadStateEnabled/)

const unreadSource = read('src/modules/notification/notification-unread.service.ts')
assert.doesNotMatch(unreadSource, /notificationUnreadStateEnabled/)
const getUnreadBody = unreadSource.match(/async get\([\s\S]*?\n {2}}\n\n {2}async reconcile/)?.[0] ?? ''
assert.doesNotMatch(getUnreadBody, /countDocuments|aggregate\s*</)
assert.match(getUnreadBody, /notificationStates\.findOne/)

const databaseSource = read('src/config/database.service.ts')
assert.doesNotMatch(databaseSource, /\.dropIndex\s*\(/)
for (const bootstrapCall of [
  'this.indexNotifications()',
  'this.indexNotificationStates()',
  'this.indexNotificationActors()',
  'this.indexOutboxEvents()',
  'this.indexConversationReadStates()',
  'this.indexUserMessageStates()'
]) {
  assert.ok(databaseSource.includes(bootstrapCall), `Database bootstrap is missing ${bootstrapCall}`)
}
for (const indexName of [
  'notification_recipient_created_at_id_v2',
  'notification_deduplication_key_v2',
  'notification_unread_timeline_v2',
  'notification_active_aggregation_unique',
  'notification_state_recipient_unique',
  'notification_actor_membership_unique',
  'outbox_event_id_unique',
  'conversation_read_state_unique',
  'user_message_state_user_unique'
]) {
  assert.ok(databaseSource.includes(indexName), `Database bootstrap is missing index ${indexName}`)
}

assert.match(repositorySource, /_id:\s*notificationId,\s*recipient_id:\s*recipientId,\s*is_read:\s*false/)
assert.match(repositorySource, /unread_since:\s*new Date\(\)/)
assert.match(repositorySource, /unread_since:\s*\{\s*\$lte:\s*cutoff\.unread_since\s*}/)
const querySource = read('src/modules/notification/notification-query.service.ts')
assert.match(querySource, /recipient_id:\s*recipientId,[\s\S]*invalidated_at:\s*null/)
assert.match(policySource, /UserVerifyStatus\.Banned/)
assert.match(policySource, /userBlocks/)

const workerSource = read('src/modules/notification/notification.worker.ts')
const workerDeliveryIndex = workerSource.indexOf('if (handlerResult) this.eventHandler.deliverAfterCommit(handlerResult)')
const rootFanoutEnqueueIndex = workerSource.indexOf('await notificationFanoutQueue.add')
assert.ok(workerDeliveryIndex >= 0 && rootFanoutEnqueueIndex > workerDeliveryIndex, 'Root fanout must enqueue after commit')
assert.ok(
  workerSource.lastIndexOf('markProcessed') > rootFanoutEnqueueIndex,
  'Fanout source must be marked processed only after root fanout enqueue succeeds'
)

const fanoutWorkerSource = read('src/modules/notification/notification-fanout.worker.ts')
const fanoutDeliveryIndex = fanoutWorkerSource.indexOf(
  'if (handlerResult) this.eventHandler.deliverAfterCommit(handlerResult)'
)
const continuationEnqueueIndex = fanoutWorkerSource.indexOf('await notificationFanoutQueue.add')
assert.ok(
  fanoutDeliveryIndex >= 0 && continuationEnqueueIndex > fanoutDeliveryIndex,
  'Fanout continuation must enqueue after commit'
)
assert.match(fanoutWorkerSource, /stored\.status\s*!==\s*'processed'/)
const notificationSchemaSource = read('src/schemas/Notification.schema.ts')
assert.match(notificationSchemaSource, /unread_since\?:\s*Date/)
assert.match(deliverySource, /Reflect\.deleteProperty\(payload,\s*'unread_since'\)/)

const notificationRoute = read('src/modules/notification/notification.route.ts')
for (const route of ["get('/',", "get('/unread-count',", "post('/read-all',", "post('/:id/read',"]) {
  assert.ok(notificationRoute.includes(route), `Missing notification route ${route}`)
}

const swagger = read('swagger.yaml')
for (const route of [
  '/api/notifications:',
  '/api/notifications/unread-count:',
  '/api/notifications/read-all:',
  '/api/notifications/{id}/read:',
  '/api/conversations/unread-summary:',
  '/api/user/{followed_user_id}/follow-notification-preferences:'
]) {
  assert.ok(swagger.includes(route), `Swagger is missing ${route}`)
}

const frontendContract = read('frontend-notification-contract.md')
const runtimeSocketSource = [...sourceByPath.values()].join('\n')
for (const event of [
  '@notification:new',
  '@notification:updated',
  '@notification:removed',
  '@notification:unread-count',
  '@notification:read-state',
  '@conversation:receive',
  '@conversation:read',
  '@conversation:read-state'
]) {
  assert.ok(frontendContract.includes(event), `Frontend contract is missing ${event}`)
  assert.ok(runtimeSocketSource.includes(`'${event}'`), `Runtime Socket.IO implementation is missing ${event}`)
}
assert.match(frontendContract, /Aggregate rỗng chỉ truyền count\/version trong `@notification:removed`/)

const enumSource = read('src/constants/enums/notification.enum.ts')
const notificationTypeBlock = enumSource.match(/export enum NotificationType\s*{([\s\S]*?)}/)?.[1] ?? ''
const notificationTypes = [...notificationTypeBlock.matchAll(/=\s*'([^']+)'/g)].map((match) => match[1])
assert.ok(notificationTypes.length > 0, 'NotificationType enum is empty')
for (const type of notificationTypes) {
  assert.ok(frontendContract.includes(`\`${type}\``) || frontendContract.includes(`"${type}"`), `Undocumented NotificationType: ${type}`)
}

for (const document of ['endpoint.md', 'swagger.yaml', 'frontend-notification-contract.md']) {
  const content = read(document)
  assert.doesNotMatch(content, /NOTIFICATION_UNREAD_STATE_ENABLED/)
}

const phasePlan = read('phase-noti.md')
assert.doesNotMatch(phasePlan, /Đã triển khai, chờ xác minh gate runtime/)

console.log(
  `Notification handoff audit passed: ${sourceFiles.length} TypeScript files, ${notificationTypes.length} notification types, ${enabledByDefault.length} enabled feature defaults.`
)
