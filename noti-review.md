## Kết luận tổng thể

Kiến trúc notification hiện tại **đủ dùng cho demo/MVP nhỏ**, nhưng chưa đáp ứng các yêu cầu trong [input-noti.md](D:/NodeJS/X-full/X-ver2/input-noti.md), đặc biệt ở bốn mặt:

- Không có idempotency/deduplication đáng tin cậy.
- Không có aggregation cho like/repost/reaction.
- Message unread chưa có mô hình phù hợp để làm badge.
- Notification đang bị gọi trực tiếp và đồng bộ từ các service nghiệp vụ.

Không nên viết lại toàn hệ thống ngay. Hướng an toàn là giữ REST hiện tại và event `@notification:new`, sau đó lần lượt tách persistence, generation, delivery và domain event.

---

# 1. Kiến trúc notification hiện tại

```text
Follow
UserService.followUser()
        │
        └── notificationService.createNotification()

Tweet/Like/Mention/Reply/Repost/Quote
TweetService.createTweet()/likeTweet()
        │
        └── notificationService.createNotification()

Message
Socket @conversation:send
        │
        ├── lưu Message
        ├── cập nhật Conversation
        ├── cache Redis
        ├── emit @conversation:receive
        └── notificationService.createNotification()
                     │
                     ▼
              Kiểm tra self-notify
                     │
                     ▼
          Insert một document Notification
                     │
                     ▼
       emit @notification:new vào room userId
```

Phần đọc:

```text
GET /notifications
    ├── query MongoDB theo recipient_id
    ├── countDocuments(is_read: false)
    └── trả raw Notification

POST /notifications/:id/read
    └── set is_read = true

POST /notifications/read-all
    └── updateMany is_read = true
```

Redis hiện chỉ tham gia:

- Làm adapter cho Socket.IO nhiều instance tại [socket/index.ts](D:/NodeJS/X-full/X-ver2/src/socket/index.ts:31).
- Cache message và presence.
- Chưa lưu notification, unread count hoặc delivery job.

---

# 2. Những điểm đang làm tốt

- Notification persistence đã tập trung ở một service thay vì mỗi nơi tự insert MongoDB.
- Có chặn self-notification tại [notification.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.service.ts:20).
- Thứ tự hiện tại là insert MongoDB rồi mới emit socket. Nếu emit thất bại, notification vẫn còn để REST tải lại.
- Event được gửi vào personal room `userId`, nên một người mở nhiều tab/device đều nhận được.
- Redis Socket.IO adapter đã hỗ trợ emit xuyên nhiều backend instance.
- Endpoint mark-read luôn kèm `recipient_id`, nên người dùng không thể đánh dấu notification của người khác.
- Follow đã kiểm tra block hai chiều và quan hệ đã tồn tại tại [user.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/user/user.service.ts:197).
- Like dùng upsert và chỉ tạo notification khi `upsertedCount > 0`, vì vậy bấm like lặp khi quan hệ vẫn tồn tại không tạo thêm notification.
- Chat tải lại member list trước khi broadcast/notification, đồng thời tôn trọng mute có thời hạn tại [chat.handler.ts](D:/NodeJS/X-full/X-ver2/src/socket/chat.handler.ts:360).
- Reaction message hiện được cập nhật nguyên tử và broadcast state có thẩm quyền, là nền tảng tốt để phát thêm notification reaction.

---

# 3. Vấn đề theo mức độ

## Critical

### C1. Không có idempotency và reliable delivery

`createNotification()` luôn `insertOne()` một document mới, không có:

- `event_id`;
- `deduplication_key`;
- unique index;
- retry;
- outbox;
- dead-letter queue.

Nếu request hoặc Socket acknowledgement được retry, cùng một hành động có thể tạo nhiều notification. Đặc biệt:

- Retweet chưa có unique index theo `(actor, parent tweet, type)`.
- Message không có `client_message_id`; retry send có thể tạo cả message và notification trùng.
- Mention có thể tạo trùng do mảng đầu vào chứa `ObjectId` nhưng username parse ra `string`; `Set` không dedupe hai kiểu này tại [tweet.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/tweet/tweet.service.ts:47).

Ngược lại, notification cũng có thể bị mất:

- Follow/tweet/like đã ghi nghiệp vụ chính rồi mới insert notification.
- Nếu insert notification lỗi, API có thể trả lỗi dù nghiệp vụ chính đã thành công.
- Retry sau đó có thể gặp conflict hoặc bỏ qua notification.

Chat tốt hơn một chút vì notification chạy sau acknowledgement và có `try/catch`, nhưng khi insert lỗi thì notification mất vĩnh viễn.

### C2. Message unread không đáp ứng yêu cầu

Hiện mỗi message chứa `read_by: ObjectId[]`. Khi đọc conversation, backend chạy `updateMany` toàn bộ message chưa có user tại [conversation.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/conversation/conversation.service.ts:972).

Hệ quả:

- Không có unread count từng conversation.
- Không có tổng số unread message.
- Không có số conversation chưa đọc.
- `GET /conversations` không trả unread state.
- Muốn đánh dấu đọc phải cập nhật hàng loạt message.
- Group càng lớn thì `read_by` trên mỗi message càng phình.
- Không biết user đọc đến message nào.
- Không thể tạo badge inbox hiệu quả.
- Forwarded message còn được tạo với `read_by: []`, ngay cả sender cũng chưa được đánh dấu đọc tại [conversation.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/conversation/conversation.service.ts:2005).

### C3. Tạo MongoClient theo từng socket connection

`DatabaseService` tạo một `MongoClient` mới trong constructor tại [database.service.ts](D:/NodeJS/X-full/X-ver2/src/config/database.service.ts:29). Trong khi đó `chatHandler()` lại tạo `new DatabaseService()` tại [chat.handler.ts](D:/NodeJS/X-full/X-ver2/src/socket/chat.handler.ts:50), và handler được gọi cho mỗi socket connection.

Khi có nhiều user/tab/device, hệ thống có nguy cơ tạo quá nhiều Mongo connection pool. Đây là vấn đề scaling nghiêm trọng hơn riêng notification.

Cần chuyển `DatabaseService` thành singleton được khởi tạo một lần và inject vào các service/handler.

### C4. Không có nguồn sự kiện thống nhất

`UserService`, `TweetService` và `chat.handler` đều import trực tiếp `NotificationType` và gọi `notificationService`.

Điều này khiến:

- Business service biết chi tiết notification.
- Cùng một nghiệp vụ có thể áp dụng block/dedupe khác nhau.
- Khó thêm push notification.
- Khó retry riêng notification.
- Không có một nơi duy nhất giải quyết “Reply + Mention thì gửi gì?”.
- Khó audit xem một domain event đã được xử lý chưa.

---

## High

### H1. Notification index không được bảo đảm tạo

Startup chỉ gọi:

```ts
databaseService.createConversationIndexes()
```

tại [app.ts](D:/NodeJS/X-full/X-ver2/src/app.ts:63). `indexNotifications()` chỉ nằm trong `createIndexes()`, nên deployment mới không được bảo đảm có notification index.

Ngoài ra, `indexNotifications()` kiểm tra riêng index `recipient_id_1_created_at_-1` rồi return sớm. Nếu index đó tồn tại nhưng index unread bị thiếu, backend sẽ không tạo index unread tại [database.service.ts](D:/NodeJS/X-full/X-ver2/src/config/database.service.ts:248).

### H2. Index không khớp truy vấn

Notification được query:

```ts
filter recipient_id
sort _id descending
```

tại [notification.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.service.ts:42), nhưng index hiện tại là:

```ts
{ recipient_id: 1, created_at: -1 }
```

Không có index `{ recipient_id: 1, _id: -1 }`.

### H3. Pagination có nhiều lỗi

- Query đúng `limit`, không lấy `limit + 1`.
- `has_next_page = notifications.length === limit` có thể trả `true` dù không còn trang sau.
- Validator ghi default vào `req.validatedData`, nhưng controller lại đọc `req.query` tại [notification.controller.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.controller.ts:13).
- Gọi `GET /notifications` không truyền `limit` có thể tạo `Number(undefined) === NaN`.

### H4. Block/privacy chưa được áp dụng thống nhất

Follow kiểm tra block, nhưng các luồng sau không kiểm tra block trước khi tạo notification:

- Like.
- Reply.
- Quote.
- Repost.
- Mention.

`NotificationService` chỉ kiểm tra self-notify, không kiểm tra actor/recipient đang block nhau.

Nếu block xảy ra sau khi notification đã tồn tại, notification cũ vẫn chứa `sender_id`. Chưa có quy tắc archive, redact hoặc loại actor khỏi aggregate.

### H5. Mention có thể trùng và Reply + Mention tạo hai notification

Nếu parent tweet owner đồng thời được mention trong reply, code hiện tạo:

- Một notification `Reply`.
- Một notification `Mention`.

Ngoài ra, explicit mention ID và mention parse từ content có thể cùng chỉ tới một người nhưng vẫn tạo hai notification do khác kiểu `ObjectId`/`string`.

Quy tắc đề xuất:

- Với cùng recipient và cùng tweet:
  - `Reply` hoặc `Quote` thắng `Mention`.
  - Lưu `context.mentioned = true`.
  - Người được mention khác parent owner vẫn nhận `Mention`.

### H6. Không có aggregation và undo reconciliation

Like và repost hiện tạo một document cho mỗi actor.

Khi:

- unlike;
- undo repost;
- xóa tweet;
- xóa reply/quote;

notification cũ không được cập nhật hoặc xóa. `deleteTweet()` cũng không xử lý notification target tại [tweet.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/tweet/tweet.service.ts:1008).

### H7. Mute đang bị dùng sai tầng delivery

Trong chat, mute làm backend không tạo notification document.

Mute nên chủ yếu điều khiển:

- push;
- âm thanh;
- toast realtime.

Nó không nên làm mất:

- unread message state;
- conversation activity;
- lịch sử in-app, nếu sản phẩm muốn hiển thị message activity.

Hiện persistence và delivery preference bị trộn vào nhau.

### H8. Các đường tạo Message không thống nhất

`@conversation:send` có:

- broadcast;
- Redis cache;
- notification.

Nhưng `forwardMessage()` insert message và update preview mà không:

- emit `@conversation:receive`;
- tạo unread;
- tạo notification;
- cập nhật cache tương ứng.

Đây là ví dụ rõ ràng cho coupling do logic message nằm trực tiếp trong Socket handler.

---

## Medium

- Schema chỉ có `sender_id` và `target_id`, không thể hiện target là tweet, message hay conversation.
- API trả raw IDs, không hydrate actor hoặc target preview.
- Không có `updated_at`, `read_at`, `invalidated_at`.
- Không có socket event khi mark-one/read-all, nên nhiều tab lệch badge.
- Không có endpoint unread count riêng.
- `countDocuments()` chạy mỗi lần tải notification.
- Event socket không chứa unread count hoặc state version.
- Socket reconnect không có state recovery; client bắt buộc phải refetch.
- `GroupAdd` và `GroupJoin` có enum nhưng chưa được dùng.
- Message reply, message reaction và group mention chưa có notification riêng.
- Group membership chỉ emit `@conversation:group-updated`; chưa có system message hoặc direct notification cho người bị kick/được cấp admin.
- Tạo group ban đầu không emit activity cho các thành viên mới.
- Notification DTO dùng toàn bộ `any`.
- Không có test cho notification.
- Swagger hiện không mô tả notification endpoints/response.

## Low

- Tên `sender_id` nên chuyển dần thành `actor_id`.
- Logging chỉ dùng `console.error`, không có `event_id`, recipient, retry count hoặc metrics.
- Event name trong roadmap là `new_notification`, trong code là `@notification:new`.
- Không có retention/TTL policy.
- Redis pub/sub clients chưa đăng ký error handler riêng rõ ràng.

---

# 4. Đối chiếu nghiệp vụ bắt buộc

## Follow

Hiện tại:

- Có notification khi follow.
- Có kiểm tra block hai chiều.
- Có kiểm tra existing follow.
- Không tạo self-notification.

Nhưng `followUser()` chưa chặn self-follow trước khi insert. User có thể tạo quan hệ follow chính mình và tăng counters, dù NotificationService sau đó bỏ notification.

Cần:

- Chặn `user_id === followed_user_id`.
- Dùng insert/upsert nguyên tử thay cho “find rồi insert”.
- Catch duplicate key như một kết quả idempotent.
- Dedupe notification theo follower relation/event ID.
- Notification generator vẫn kiểm tra block như defense-in-depth.

## Người đang follow đăng tweet mới

Chưa triển khai.

Khuyến nghị:

- Thêm `post_notifications_enabled` vào follow relation, mặc định `false`.
- Chỉ phát `TweetOriginalCreated` khi `type === TweetType.Tweet`.
- Không phát cho reply/repost/quote/edit.
- Dùng queued fan-out on write cho những follower đã opt-in.
- Chia recipient thành batch, ví dụ 500–1.000 người/job.
- Không fan-out đồng bộ trong request tạo tweet.
- Với tài khoản cực lớn, vẫn queue theo partition; fan-out on read không phù hợp cho badge/push vì không tạo được unread state đúng thời điểm.

## Tweet interactions

- Like: có nhưng chưa aggregation/undo.
- Repost: có notification nhưng nguồn repost chưa unique.
- Quote: có notification riêng, phù hợp.
- Reply: có notification riêng, phù hợp.
- Bookmark/view: không tạo notification, đúng.
- Self interaction: đã được loại phần lớn ở caller và NotificationService.

Cần aggregation cho Like/Repost; Quote/Reply giữ riêng.

## Mention

- Parse được mention trong tweet/reply/quote.
- Username không tồn tại được bỏ qua.
- Mention lặp trong text thuần thường được DB query trả về một user.

Thiếu:

- Dedupe ObjectId/string.
- Block check.
- Edit mention reconciliation.
- Target deletion cleanup.
- Reply + mention collapse.
- Self mention nên loại trước khi tạo event, không chỉ dựa vào NotificationService.

## Messaging

Hiện chỉ có notification generic `Message`.

Chưa có:

- Message reply riêng.
- Group mention.
- Message reaction.
- Per-conversation unread counter.
- Inbox badge.
- Active conversation/read acknowledgement.
- Group management notifications/system messages.

---

# 5. Kiến trúc đề xuất

```text
Business transaction
    │
    ├── ghi dữ liệu nghiệp vụ
    └── ghi DomainEvent vào Outbox
               │
               ▼
       Outbox Publisher
               │
               ▼
     BullMQ notification-events
               │
               ▼
      Notification Policy Handler
        ├── resolve recipients
        ├── privacy/block checks
        ├── dedupe/aggregation
        └── delivery preferences
               │
               ▼
      Notification Repository
        ├── persist/upsert notification
        ├── update unread state
        └── commit
               │
               ▼
      Delivery Coordinator
        ├── Socket.IO
        ├── notification badge
        └── push job trong tương lai
```

### Tại sao Outbox + BullMQ?

Dự án đã có BullMQ và Redis cho video processing. Tuy nhiên chỉ enqueue BullMQ trực tiếp sau business write vẫn có cửa sổ mất sự kiện:

```text
Mongo commit thành công
process crash trước queue.add()
```

Transactional outbox giải quyết cửa sổ này:

- Business data và outbox event được ghi trong cùng Mongo transaction.
- Worker có thể retry.
- `event_id` dùng làm BullMQ `jobId`.
- Notification persistence có dedupe key nên worker chạy lại không tạo trùng.
- Job lỗi lâu dài được chuyển sang failed/DLQ để theo dõi.

Không cần áp dụng outbox cho mọi module ngay. Có thể migrate Follow/Tweet trước, rồi đến Message.

---

# 6. Schema và index đề xuất

Không nên lưu một mảng `actor_ids` không giới hạn trong notification vì viral tweet có thể chạm giới hạn document MongoDB.

## Notification

```ts
type Notification = {
  _id: ObjectId
  recipient_id: ObjectId

  type: NotificationType

  target_type?: 'USER' | 'TWEET' | 'MESSAGE' | 'CONVERSATION'
  target_id?: ObjectId

  actor_ids_preview: ObjectId[] // tối đa 3 actor mới nhất
  actor_count: number

  aggregation_key?: string
  deduplication_key?: string

  context?: {
    conversation_id?: ObjectId
    parent_tweet_id?: ObjectId
    reply_to_message_id?: ObjectId
    mentioned?: boolean
    emoji?: string
  }

  is_read: boolean
  read_at?: Date

  created_at: Date
  updated_at: Date
  invalidated_at?: Date
}
```

## NotificationActor

Dùng cho notification được gom:

```ts
type NotificationActor = {
  _id: ObjectId
  notification_id: ObjectId
  actor_id: ObjectId
  source_id: ObjectId
  context?: Record<string, unknown>
  created_at: Date
  updated_at: Date
}
```

## NotificationState

```ts
type NotificationState = {
  recipient_id: ObjectId
  unread_count: number
  version: number
  updated_at: Date
}
```

`unread_count` là số notification item chưa đọc. Một aggregate “100 người đã like” chỉ tính là một item unread.

## ConversationMembership

```ts
type ConversationMembership = {
  conversation_id: ObjectId
  conversation_type: 'direct' | 'group'
  user_id: ObjectId
  role: 'admin' | 'member'

  last_read_message_id?: ObjectId
  last_read_at?: Date
  unread_message_count: number

  joined_at: Date
  muted_until?: Date | null
}
```

`read_by` trên Message có thể được dual-write trong giai đoạn migration rồi loại dần.

## Index

```ts
notifications:
  { recipient_id: 1, updated_at: -1, _id: -1 }

  { recipient_id: 1, updated_at: -1 }
  partialFilter: { is_read: false, invalidated_at: { $exists: false } }

  { deduplication_key: 1 }
  unique + partialFilter exists

  { recipient_id: 1, aggregation_key: 1 }
  unique + partialFilter aggregation_key exists

  { target_type: 1, target_id: 1 }

notification_actors:
  { notification_id: 1, actor_id: 1 } unique
  { notification_id: 1, created_at: -1 }
  { source_id: 1 }

notification_states:
  { recipient_id: 1 } unique

conversation_memberships:
  { conversation_id: 1, user_id: 1 } unique
  { user_id: 1, unread_message_count: 1 }
  { user_id: 1, updated_at: -1 }

outbox_events:
  { event_id: 1 } unique
  { status: 1, available_at: 1 }
```

---

# 7. Aggregation và deduplication

## Like/Repost

Aggregation key:

```text
recipientId:TWEET_LIKED:tweetId
recipientId:TWEET_REPOSTED:tweetId
```

Quy tắc:

- Actor mới:
  - insert `NotificationActor` với unique `(notification_id, actor_id)`;
  - chỉ tăng `actor_count` nếu insert actor thành công;
  - cập nhật preview actor gần nhất;
  - nếu aggregate đã read, chuyển lại unread và tăng notification unread count đúng một lần.
- Like/repost retry:
  - unique actor edge ngăn tăng count lần hai.
- Unlike/undo repost:
  - xóa actor edge;
  - chỉ giảm count khi thực sự xóa được một edge;
  - nếu count về 0 thì invalidate/xóa aggregate;
  - nếu notification đang unread, giảm unread state.
- Quote/Reply:
  - mỗi source tweet có `deduplication_key` riêng;
  - không aggregation.

## Mention

```text
deduplication_key =
recipientId:TWEET_MENTIONED:tweetId
```

Normalize tất cả mention ID thành string trước khi `Set`.

Reply/Quote + Mention cùng recipient:

- Chỉ tạo Reply/Quote.
- Gắn `context.mentioned = true`.

## Message

Mỗi message phải có `client_message_id` hoặc `idempotency_key` do client sinh:

```text
senderId:clientMessageId
```

Unique index bảo đảm retry socket không insert message lần hai.

Recipient intent priority:

```text
group mention > message reply > direct message > group message
```

Một recipient chỉ nhận một notification intent cho cùng message.

## Message reaction

Aggregation key:

```text
messageOwnerId:MESSAGE_REACTED:messageId
```

- Đổi emoji: cập nhật actor edge, không tăng count.
- Xóa reaction: xóa actor edge và giảm count.
- React lặp: không tăng count.
- Revoke/delete target: invalidate reaction notification.

---

# 8. Unread count

## Notification badge

Đại diện cho:

> Số notification item chưa đọc.

Aggregate 100 likes = 1 unread item.

Các mutation phải update Notification và NotificationState trong cùng transaction.

Socket payload nên là:

```ts
{
  ;(notification, unread_count, version)
}
```

Các event tương thích:

```text
@notification:new       // giữ event hiện tại
@notification:updated   // aggregate thay đổi
@notification:removed
@notification:read-state
```

Reconnect phải gọi REST để reconcile; Redis Pub/Sub không phải durable queue.

## Message badge

Mình chọn:

> Badge icon Messages hiển thị số conversation có ít nhất một message chưa đọc.

Lý do:

- Một group nhiều traffic không áp đảo badge.
- Con số thể hiện số cuộc hội thoại cần xử lý.
- Ổn định hơn tổng message unread.

Backend vẫn nên trả đủ:

```ts
{
  unread_conversation_count: number,
  total_unread_message_count: number
}
```

Mỗi conversation trả:

```ts
{
  unread_message_count: number,
  last_read_message_id?: string
}
```

Khi message mới đến:

- Tăng `unread_message_count` của mọi recipient, không tăng sender.
- Nếu count trước đó bằng 0, unread conversation count tăng một.
- User đang mở đúng conversation vẫn nhận message; frontend gửi read acknowledgement chứa `message_id`.
- Không dựa hoàn toàn vào “active conversation” lưu Redis vì tab có thể crash hoặc mất kết nối.
- Redis active-state chỉ dùng để quyết định push/toast, không làm nguồn sự thật cho unread.

---

# 9. Notification event matrix đề xuất

| Domain event                 |                     In-app |               Socket |                Badge |       System message |              Push |
| ---------------------------- | -------------------------: | -------------------: | -------------------: | -------------------: | ----------------: |
| User followed                |                         Có |                   Có |         Notification |                Không |          Tùy chọn |
| Followed user đăng tweet gốc |              Có nếu opt-in |                   Có |         Notification |                Không |          Tùy chọn |
| Tweet liked                  |            Có, aggregation |                   Có |         Notification |                Không |    Không mặc định |
| Tweet reposted               |            Có, aggregation |                   Có |         Notification |                Không |    Không mặc định |
| Tweet quoted                 |               Có, riêng lẻ |                   Có |         Notification |                Không |          Tùy chọn |
| Tweet replied                |               Có, riêng lẻ |                   Có |         Notification |                Không |          Tùy chọn |
| Tweet mentioned              |               Có, riêng lẻ |                   Có |         Notification |                Không |          Tùy chọn |
| Direct message mới           | Không cần vào activity tab |                   Có |                Inbox |                Không | Có nếu không mute |
| Group message mới            |             Không mặc định |                   Có |                Inbox |                Không | Có nếu không mute |
| Message reply                |   Có cho owner message gốc |                   Có | Notification + Inbox |                Không | Có nếu không mute |
| Group message mention        |            Có, ưu tiên cao |                   Có | Notification + Inbox |                Không | Có nếu không mute |
| Message reaction             |            Có, aggregation |                   Có |         Notification |                Không |    Không mặc định |
| Member được thêm             |          Có cho member mới |                   Có |         Notification |         Có cho group |          Tùy chọn |
| Member tự rời                |            Không cho actor |                   Có |   Inbox nếu chưa đọc |         Có cho group |             Không |
| Member bị kick               |       Có cho người bị kick |                   Có |         Notification | Có cho group còn lại |          Tùy chọn |
| Được cấp/thu hồi admin       |  Có cho người bị ảnh hưởng |                   Có |         Notification |         Có cho group |          Tùy chọn |
| Target bị xóa                |             Xóa/invalidate | Có nếu đang hiển thị |           Điều chỉnh |           Tùy target |             Không |

---

# 10. File cần sửa hoặc tạo

## File hiện tại cần sửa

- [app.ts](D:/NodeJS/X-full/X-ver2/src/app.ts)
- [database.service.ts](D:/NodeJS/X-full/X-ver2/src/config/database.service.ts)
- [redis.service.ts](D:/NodeJS/X-full/X-ver2/src/config/redis.service.ts)
- [Notification.schema.ts](D:/NodeJS/X-full/X-ver2/src/schemas/Notification.schema.ts)
- [Message.schema.ts](D:/NodeJS/X-full/X-ver2/src/schemas/Message.schema.ts)
- [DirectConversation.schema.ts](D:/NodeJS/X-full/X-ver2/src/schemas/DirectConversation.schema.ts)
- [GroupConversation.schema.ts](D:/NodeJS/X-full/X-ver2/src/schemas/GroupConversation.schema.ts)
- [notification.enum.ts](D:/NodeJS/X-full/X-ver2/src/constants/enums/notification.enum.ts)
- [notification.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.service.ts)
- [notification.controller.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.controller.ts)
- [notification.route.ts](D:/NodeJS/X-full/X-ver2/src/modules/notification/notification.route.ts)
- [notification DTO](D:/NodeJS/X-full/X-ver2/src/modules/notification/dto/index.ts)
- [user.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/user/user.service.ts)
- [tweet.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/tweet/tweet.service.ts)
- [conversation.service.ts](D:/NodeJS/X-full/X-ver2/src/modules/conversation/conversation.service.ts)
- [chat.handler.ts](D:/NodeJS/X-full/X-ver2/src/socket/chat.handler.ts)
- [socket/index.ts](D:/NodeJS/X-full/X-ver2/src/socket/index.ts)
- `endpoint.md`
- `swagger.yaml`

## File/schema mới nên có

```text
src/schemas/NotificationActor.schema.ts
src/schemas/NotificationState.schema.ts
src/schemas/ConversationMembership.schema.ts
src/schemas/OutboxEvent.schema.ts

src/modules/notification/notification-event.type.ts
src/modules/notification/notification-policy.service.ts
src/modules/notification/notification.repository.ts
src/modules/notification/notification-delivery.service.ts
src/modules/notification/notification-unread.service.ts
src/modules/notification/notification.worker.ts

src/modules/events/domain-event.publisher.ts
src/modules/events/outbox.repository.ts
src/queues/notification.queue.ts

tests/notification/
tests/conversation-unread/
```

---

# 11. Thứ tự refactor an toàn

## Phase 0 — Khóa contract và baseline

- Ghi lại REST response/event hiện tại.
- Thêm test cho Follow, Like, Reply, Mention, Message và read APIs.
- Không đổi frontend contract.
- Giữ `@notification:new`.

## Phase 1 — Sửa lỗi nền tảng

- Dùng một MongoClient singleton.
- Startup bảo đảm tạo từng index độc lập.
- Sửa validator/controller dùng `validatedData`.
- Thêm validator notification ID.
- Sửa pagination `limit + 1`.
- Normalize mention IDs.
- Chặn self-follow.
- Thêm block check thống nhất.

## Phase 2 — Mở rộng schema theo kiểu additive

- Thêm `target_type`, `updated_at`, `read_at`.
- Thêm `aggregation_key`, `deduplication_key`.
- Thêm indexes mới.
- Response vẫn giữ `sender_id`, `target_id` để frontend cũ không vỡ.
- Thêm actor/target hydrated fields mới.

## Phase 3 — Tách generation/persistence/delivery

- `NotificationRepository` chỉ thao tác DB.
- `NotificationPolicyService` resolve recipient và privacy.
- `NotificationDeliveryService` chỉ emit socket.
- `NotificationService` cũ trở thành facade tương thích.
- Chưa cần queue ngay.

## Phase 4 — Domain events và idempotency

- Thêm typed domain events.
- Migrate Follow, Like, Tweet create trước.
- Mỗi event có `event_id`.
- Notification dùng unique deduplication key.
- Loại direct call `NotificationType` khỏi business service.

## Phase 5 — Outbox và BullMQ

- Ghi business mutation + outbox event trong transaction.
- Outbox publisher enqueue BullMQ bằng `jobId = event_id`.
- Retry/backoff và failed queue.
- Chỉ emit socket sau khi notification persistence commit.

## Phase 6 — Social aggregation

- Like/repost aggregation.
- Unlike/undo reconciliation.
- Reply/mention dedup.
- Target delete/invalidate.
- Block cleanup/redaction.

## Phase 7 — Notification unread state

- Thêm `NotificationState`.
- Mark-one/read-all có transaction và `read_at`.
- Socket sync nhiều tab.
- Endpoint unread count.
- Payload có `version`.

## Phase 8 — Message unread migration

- Thêm `ConversationMembership`.
- Dual-write `read_by` và membership trong thời gian chuyển đổi.
- Trả unread từng conversation.
- Thêm global inbox unread summary.
- Frontend ack message ID khi đang mở conversation.
- Sau khi ổn định mới bỏ phụ thuộc vào `Message.read_by`.

## Phase 9 — Message/group notification

- `MessageCreated`, `MessageReplied`, `MessageMentioned`.
- Reaction aggregation.
- System message cho group membership.
- Direct notification cho add/kick/admin change.
- Đưa send và forward qua cùng một message application service.

## Phase 10 — Followed-user tweet notification

- Preference theo follow relation.
- Chỉ tweet gốc.
- Fan-out qua queue theo batch.
- Rate limit và backpressure cho tài khoản lớn.

## Phase 11 — Cleanup và observability

- Xóa đường direct-call cũ.
- Structured logging với `event_id`.
- Metrics queue lag, failed jobs, socket delivery và duplicate suppression.
- Swagger, endpoint docs và migration notes.
- Test retry, race, reconnect, multi-tab và target deletion.

Mình chưa sửa code ở bước này, đúng theo yêu cầu “phân tích trước, sau đó mới thực hiện sửa”. Kiến trúc nên được triển khai theo các phase trên; không nên bắt đầu bằng việc thay toàn bộ `Notification.schema.ts` trong một lần vì sẽ phá contract frontend và rất khó xác minh lỗi.
