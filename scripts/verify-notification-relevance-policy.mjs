import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const { NotificationType } = require('../dist/constants/enums/notification.enum.js')
const {
  SUPPRESSED_NOTIFICATION_TYPES,
  getEligibleNotificationTypeFilter,
  isEligibleNotificationType
} = require('../dist/modules/notification/notification-eligibility.js')

assert.deepEqual(SUPPRESSED_NOTIFICATION_TYPES, [NotificationType.Message, NotificationType.MessageReaction])
assert.equal(isEligibleNotificationType(NotificationType.Message), false)
assert.equal(isEligibleNotificationType(NotificationType.MessageReaction), false)
assert.equal(isEligibleNotificationType(NotificationType.MessageReply), true)
assert.equal(isEligibleNotificationType(NotificationType.MessageMention), true)
assert.deepEqual(getEligibleNotificationTypeFilter(), {
  $nin: [NotificationType.Message, NotificationType.MessageReaction]
})

const conversationSource = read('src/modules/conversation/conversation.service.ts')
assert.doesNotMatch(conversationSource, /type:\s*DomainEventType\.MessageReaction(?:Changed|Removed)/)
assert.match(conversationSource, /'@message:reaction-updated'/)

const handlerSource = read('src/modules/notification/notification-event.handler.ts')
assert.match(handlerSource, /case DomainEventType\.MessageReactionChanged:/)
assert.match(handlerSource, /case DomainEventType\.MessageReactionRemoved:/)
assert.match(handlerSource, /message_reaction_not_supported/)

const policySource = read('src/modules/notification/notification-policy.service.ts')
assert.match(
  policySource,
  /command\.type === NotificationType\.Message \|\| command\.type === NotificationType\.MessageReaction/
)

const querySource = read('src/modules/notification/notification-query.service.ts')
assert.match(querySource, /type:\s*getEligibleNotificationTypeFilter\(\)/)

const repositorySource = read('src/modules/notification/notification.repository.ts')
assert.equal((repositorySource.match(/type:\s*getEligibleNotificationTypeFilter\(\)/g) ?? []).length, 2)
assert.match(repositorySource, /isEligibleNotificationType\(notification\.type\)/)

const unreadSource = read('src/modules/notification/notification-unread.service.ts')
assert.match(unreadSource, /type:\s*getEligibleNotificationTypeFilter\(\)/)
assert.doesNotMatch(unreadSource, /policy_version|NOTIFICATION_POLICY_VERSION|getSuppressedNotificationTypeFilter/)

const stateSchemaSource = read('src/schemas/NotificationState.schema.ts')
assert.doesNotMatch(stateSchemaSource, /policy_version/)

const contract = read('frontend-notification-contract.md')
assert.match(contract, /Generic `message` và `message_reaction`/)
assert.match(contract, /Reaction không tạo outbox notification mới/)

console.log('Notification relevance policy verification passed')
