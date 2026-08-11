# Kế hoạch triển khai Backend Notification toàn hệ thống

> Phạm vi tài liệu: chỉ lập kế hoạch backend cho `X-ver2`, dựa trên code hiện tại và ba tài liệu `input-noti.md`, `noti-review.md`, `prompt-noti.md`. Không triển khai frontend trong bước lập kế hoạch này. Database hiện chỉ là local/test và dữ liệu cũ có thể bị xóa; kế hoạch không yêu cầu data migration, backfill, archive, dry-run hoặc resume để bảo toàn dữ liệu cũ.

## 1. Mục tiêu cuối cùng

Sau khi hoàn thành toàn bộ kế hoạch, backend phải có một luồng notification thống nhất và có thể phục hồi:

```text
Business mutation
    → typed domain event + event_id
    → transactional outbox
    → BullMQ notification worker
    → notification policy/recipient resolution
    → persistence hoặc aggregation
    → unread state
    → Socket.IO delivery vào personal room
```

Hệ thống cuối cùng phải đạt các kết quả sau:

1. Follow, reply, quote, mention, like, repost và tweet gốc từ tài khoản được bật thông báo đều đi qua một policy thống nhất; self-action, block, retry và target không còn hợp lệ được xử lý nhất quán.
2. Like/repost và reaction message được aggregate mà không giữ mảng actor không giới hạn; undo làm giảm đúng actor/count và không làm sai unread count.
3. Notification badge là **số notification item chưa đọc**; một aggregate có nhiều actor vẫn chỉ tính một item.
4. Inbox badge là **số conversation có ít nhất một message chưa đọc**; backend đồng thời trả tổng unread message và unread count từng conversation.
5. Message read position dùng read-state riêng với `last_read_message_id`, `last_read_at`, `unread_message_count`; sau local reset, `Message.read_by` không còn là nguồn sự thật và không cần dual-write để bảo toàn dữ liệu cũ.
6. Send và forward message dùng cùng message command service; socket retry có thể chống duplicate bằng `sender_id + client_message_id`.
7. Reply/mention/reaction message và group-management event có notification/system message đúng người nhận, không tạo hai intent trùng cho một recipient.
8. Notification được persist trước realtime emit; worker retry là at-least-once nhưng persistence idempotent. Socket reconnect luôn có REST state để reconcile.
9. Tweet gốc fan-out chỉ tới follow relation đã opt-in, chạy theo batch trong queue và không kéo dài request tạo tweet.
10. REST endpoint và socket event legacy tiếp tục hoạt động để giữ tương thích frontend, đặc biệt `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read` và `@notification:new`; việc giữ contract không đồng nghĩa phải giữ dữ liệu local cũ.

## 2. Code hiện tại đã kiểm tra

### 2.1. Khu vực và contract thật

Đã đối chiếu trực tiếp các khu vực sau:

- `src/modules/notification`: route/controller/service/DTO hiện tại.
- `src/modules/user/user.service.ts`, `user.route.ts`, `user.validator.ts`: follow, unfollow, block và unblock.
- `src/modules/tweet/tweet.service.ts`, route/controller/validator: create/update/delete tweet, like/unlike, repost/undo, quote/reply và mention.
- `src/modules/conversation`: send-related persistence, forward, read, reaction, group member/admin operations và message sync.
- `src/socket/index.ts`, `src/socket/chat.handler.ts`: personal rooms, Redis adapter, message broadcast và notification generic cho message.
- `src/schemas`: Notification, Message, Follower, Tweet, Like, DirectConversation, GroupConversation và UserBlock.
- `src/config/database.service.ts`, `redis.service.ts`, `redisConfig.ts`, `getEnvConfig.ts`.
- `src/queues/video.queue.ts`: convention BullMQ hiện có.
- `src/app.ts`, `endpoint.md`, `swagger.yaml`.

### 2.2. Luồng thực tế hiện tại

```text
UserService.followUser()
TweetService.createTweet()/likeTweet()
Socket @conversation:send
        ↓ gọi trực tiếp
NotificationService.createNotification()
        ↓
insertOne notifications
        ↓
emit @notification:new tới room recipient_id
```

REST notification hiện có:

```text
GET  /api/notifications
POST /api/notifications/read-all
POST /api/notifications/:id/read
```

Notification hiện được tạo cho:

- follow;
- like tweet;
- reply/repost/quote tweet;
- mention tweet;
- mỗi direct/group message không bị mute.

Chưa có notification cho:

- tweet gốc của tài khoản được follow;
- reply message có ưu tiên riêng;
- group mention;
- reaction message;
- group add/kick/admin grant/admin revoke;
- target lifecycle và block cleanup.

### 2.3. Các ràng buộc code phải tôn trọng

- Socket chỉ join personal room `userId`; không giả định client join room conversation.
- Redis adapter đã cho phép personal-room emit xuyên nhiều backend instance, nhưng Redis Pub/Sub không lưu event offline.
- `Message.read_by` và `markAsRead()` hiện phải scan/update nhiều message; `GET /conversations` không trả unread count.
- `forwardMessage()` insert trực tiếp, không đi qua đầy đủ cache/broadcast/notification giống `@conversation:send`.
- `DatabaseService` tạo `MongoClient` trong constructor; `chatHandler()` tạo `DatabaseService` theo từng socket connection.
- Bootstrap chỉ gọi `createConversationIndexes()`, không bảo đảm notification indexes trong `createIndexes()` được tạo.
- Validator lưu dữ liệu parse/default vào `req.validatedData`, nhưng notification controller vẫn đọc `req.query` thô.
- Notification schema chỉ có `recipient_id`, `sender_id`, `type`, `target_id`, `is_read`, `created_at`.
- Repo chưa có test suite khả dụng: script `test:conversation-foundation` tham chiếu `tsconfig.test.json` và thư mục `tests` hiện không tồn tại. Kế hoạch không tự cài framework mới.

### 2.4. Cần xác minh trước khi triển khai

1. **Trước Phase 6:** MongoDB deployment thực tế phải chạy được multi-document transaction bằng một smoke test `startSession().withTransaction()`. URI hiện là MongoDB Atlas nhưng code không đủ để chứng minh tier/topology ở mọi môi trường.
2. **Trước Phase 12:** phải chốt hoặc đo giới hạn member tối đa của group. Nếu product chưa có giới hạn, cần cấu hình một giới hạn được hỗ trợ hoặc chứng minh bulk read-state update đạt SLA với group lớn nhất dự kiến.
3. **Trước Phase 12:** frontend phải gửi `client_message_id` khi muốn chống retry và dùng read-position contract mới. Local database được reset trực tiếp khi chuyển schema; không triển khai giai đoạn dual-write `Message.read_by`.

Nếu transaction smoke test thất bại, Phase 6 không được đánh dấu hoàn thành. Phương án tạm chỉ có thể là outbox best-effort + reconciliation, không được mô tả là atomic hoặc reliable tương đương transactional outbox.

## 3. Quyết định kiến trúc đã chốt

### 3.1. Boundary module

```text
src/modules/events
    typed domain-event contract, outbox repository và publisher

src/modules/notification
    policy, repository, query/hydration, aggregation, unread và delivery

src/modules/conversation
    message command, conversation read-state và system message

src/queues
    BullMQ queue declarations; worker logic vẫn nằm trong owning module
```

- Business service chỉ ghi business state và publish domain event; không tự chọn NotificationType, recipient hoặc socket event.
- Notification policy quyết định recipient, precedence, block/privacy và delivery channel.
- Repository chỉ quản lý persistence/idempotency/aggregation transaction.
- Delivery service chỉ emit sau commit; không quyết định nghiệp vụ.
- Redis là transport/cache, không là nguồn sự thật của unread count.

### 3.2. Notification schema đích

`Notification.schema.ts` được mở rộng additive; field legacy được giữ:

```ts
type Notification = {
  _id: ObjectId
  recipient_id: ObjectId

  // Legacy compatibility: actor mới nhất hoặc actor duy nhất.
  sender_id: ObjectId | null
  type: NotificationType
  target_id: ObjectId | null
  is_read: boolean
  created_at: Date

  target_type?: 'USER' | 'TWEET' | 'MESSAGE' | 'CONVERSATION'
  actor_ids_preview?: ObjectId[] // tối đa 3
  actor_count?: number
  context?: Record<string, unknown>

  deduplication_key?: string
  aggregation_key?: string
  aggregation_active?: boolean

  read_at?: Date | null
  updated_at?: Date
  invalidated_at?: Date | null
}
```

Không lưu toàn bộ actor trong `actor_ids_preview`. Aggregate dùng collection `notificationActors` làm nguồn membership/count an toàn.

### 3.3. Pagination ổn định

- Notification list sort theo tuple immutable `{ created_at: -1, _id: -1 }`.
- Cursor mới là opaque cursor chứa cả `created_at` và `_id`; cursor ObjectId legacy vẫn được chấp nhận trong thời gian chuyển đổi.
- Query lấy `limit + 1`.
- Aggregate đang unread được update tại vị trí cũ; không đổi `created_at`, nên không nhảy giữa các page.
- Client vẫn phải dedupe theo `_id` và refetch page đầu sau socket reconnect.

### 3.4. Aggregation và unread transition

Các loại aggregate:

```text
TWEET_LIKED
TWEET_REPOSTED
MESSAGE_REACTED
```

Logical aggregation key:

```text
recipient:type:target_id
```

Quy tắc window:

1. Khi aggregate còn unread/active, actor mới update cùng document; notification badge không tăng thêm.
2. Khi aggregate được read, `aggregation_active=false` và window đóng.
3. Activity mới sau đó tạo aggregate window mới ở đầu feed, unread count tăng đúng một.
4. `NotificationActor` unique theo `(notification_id, actor_id)`; mỗi edge giữ `source_key` và `last_event_id`, retry không tăng `actor_count` lần hai.
5. Undo tìm đúng active/latest actor edge theo `source_key`; chỉ giảm count khi edge thực sự tồn tại.
6. `actor_count` về 0 thì set `invalidated_at`, không physical delete; nếu document đang unread thì giảm unread state một lần.
7. Actor preview lấy tối đa ba actor mới nhất còn hợp lệ.

Điểm này điều chỉnh `noti-review.md`: không mở lại chính aggregate đã read, vì làm document cũ nhảy vị trí hoặc khiến pagination khó ổn định.

### 3.5. Precedence và deduplication

Social precedence cho cùng recipient và cùng source tweet:

```text
Quote > Reply > Mention
```

- Quote và Reply là hai TweetType khác nhau; mỗi source tweet chỉ có một intent chính.
- Nếu owner của parent đồng thời nằm trong mentions, chỉ tạo Quote/Reply và đặt `context.mentioned=true`.
- Mention recipient khác vẫn nhận Mention riêng.

Message precedence:

```text
Group mention > Message reply > generic direct/group message
```

- Generic message không xuất hiện trong notification tab ở kiến trúc đích; nó chỉ cập nhật inbox unread, `@conversation:receive` và future push.
- Reply target sender nhận MessageReply.
- Group mention recipient nhận MessageMention; nếu đồng thời là reply target, chỉ MessageMention với `context.reply_to_message_id`.

Deduplication key cá nhân:

```text
recipient:event_type:source_type:source_id
```

Follow dùng follower relation `_id`; Reply/Quote/Mention dùng child tweet `_id`; MessageReply/MessageMention dùng message `_id`; group action dùng outbox `event_id`.

### 3.6. Badge và read state

Notification badge:

```text
số Notification document chưa đọc và chưa invalidated
```

Message icon badge:

```text
số conversation có unread_message_count > 0
```

Backend đồng thời trả:

```text
unread_conversation_count
total_unread_message_count
unread_message_count từng conversation
last_read_message_id từng conversation
```

Nguồn sự thật message read là `ConversationReadState`, không tạo `ConversationMembership` thứ hai chứa role/membership vì sẽ xung đột với `DirectConversation` và `GroupConversation`. Membership/role hiện hữu tiếp tục là nguồn authorization; read-state chỉ giữ:

```ts
conversation_id
conversation_type
user_id
last_read_message_id
last_read_at
unread_message_count
created_at
updated_at
```

`UserMessageState` giữ tổng badge theo user. Sau khi reset message/read-state local ở Phase 12, `Message.read_by` không còn được đọc hoặc dual-write; read-state mới là nguồn sự thật duy nhất.

### 3.7. Message idempotency

- Socket payload bổ sung optional `client_message_id` trong thời gian tương thích.
- Unique partial index `{ sender_id: 1, client_message_id: 1 }` áp dụng khi `client_message_id` tồn tại.
- Retry cùng key trả lại message id cũ và không broadcast/increment unread lần hai.
- Forward REST bổ sung optional `client_operation_id`; id từng target được dẫn xuất từ operation id + target conversation.
- Backend không thể bảo đảm dedupe tuyệt đối cho client không gửi key; frontend cần áp dụng field mới trước khi backend bắt buộc nó.

### 3.8. Group event matrix đã chốt

| Event                              | Notification cá nhân | System message                        | Realtime                                                | Unread message                                 |
| ---------------------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Member added/joined qua add/create | Member mới           | “A added B”/“Group created”           | `@conversation:group-updated` + `@conversation:receive` | Có cho member hiện tại/member mới, trừ actor   |
| Member tự rời                      | Không cho actor      | “A left the group” cho member còn lại | Giữ `@conversation:group-updated`                       | Có cho member còn lại, trừ actor đã rời        |
| Member bị kick                     | Người bị kick        | “A removed B” cho member còn lại      | Giữ event group update, gửi cả người bị kick            | Có cho member còn lại, không cho người bị kick |
| Admin granted                      | Người được cấp       | System message cho group              | Group update + conversation receive                     | Có cho member trừ actor                        |
| Admin revoked                      | Người bị thu hồi     | System message cho group              | Group update + conversation receive                     | Có cho member trừ actor                        |

Code hiện không có invite/self-join route. Trong kế hoạch này, “joined” là thời điểm membership được commit bởi create/add-member; không phát thêm một notification Join trùng với GroupAdd. Public invitation/acceptance workflow là ngoài phạm vi.

### 3.9. Followed-user tweet fan-out

- Preference lưu ngay trên Follower relation: `post_notifications_enabled`, mặc định `false` cho follow relation tạo mới sau local reset.
- Chỉ `TweetType.Tweet` với `TweetAudience.Everyone` được fan-out. Circle hiện chưa có membership model đủ an toàn nên bị loại.
- Fan-out on write qua BullMQ, batch cố định 500 recipients.
- Root event không tải tất cả follower vào memory; mỗi job query một cursor page và enqueue continuation job.
- `jobId = event_id:cursor_or_first`; notification dedupe theo recipient + tweet id.
- Worker mặc định concurrency 5, attempts 8, exponential backoff; các giá trị đặt thành constant/config có thể điều chỉnh sau đo tải.
- Request tạo tweet chỉ commit Tweet + OutboxEvent, không chờ fan-out.

### 3.10. Outbox và BullMQ

Outbox cần thiết vì code hiện có cửa sổ:

```text
business write thành công
    → process chết trước createNotification()/queue.add()
```

Chỉ EventEmitter nội bộ hoặc enqueue trực tiếp không loại bỏ cửa sổ này và không replay được sau restart.

Outbox record:

```ts
event_id
type
aggregate_type
aggregate_id
actor_id
payload
occurred_at
status: pending | published | processed | dead_letter
attempts
available_at
locked_at
locked_by
last_error
```

- Business data và outbox insert nằm trong cùng Mongo transaction.
- Publisher claim record bằng lease, enqueue `jobId=event_id`, rồi mark published.
- Nếu enqueue thành công nhưng mark published thất bại, enqueue lại cùng jobId không tạo job mới.
- Worker load event từ Mongo; notification/unread mutation và mark outbox `processed` nằm trong cùng transaction, sau commit mới emit.
- Worker crash trước commit được retry idempotent; crash sau commit nhưng trước emit có thể làm mất realtime signal, nhưng REST reconnect/reconcile vẫn thấy state. Socket.IO là best-effort realtime, không được mô tả là exactly-once.

### 3.11. Push delivery

Không triển khai web/mobile push. `NotificationDeliveryService` nhận channel policy và giữ boundary để thêm push worker sau này; mọi field/token/subscription push đều ngoài phạm vi tài liệu này.

## 4. Đối chiếu với `noti-review.md`

### 4.1. Giữ nguyên

- Kết luận về thiếu idempotency, aggregation, reliable delivery và message unread model.
- Yêu cầu MongoClient dùng chung, index bootstrap đúng, block/privacy thống nhất và message write path hợp nhất.
- NotificationActor tách khỏi actor preview; NotificationState và outbox/BullMQ.
- Notification badge tính theo item; message badge tính theo conversation.
- Generic message không cần xuất hiện trong activity tab ở kiến trúc cuối.

### 4.2. Điều chỉnh

- Dùng `ConversationReadState`, không dùng `ConversationMembership` như nguồn membership/role thứ hai.
- `@notification:new` tiếp tục emit raw notification legacy; unread count phát bằng event riêng thay vì đổi payload gây vỡ frontend.
- Aggregate đã read sẽ đóng window và activity mới tạo document mới, thay vì reopen/move document cũ.
- Outbox chỉ bật sau transaction smoke test và sau khi repository/handler idempotent đã tồn tại; không đưa vào ngay Phase 1.
- Mention edit reconciliation và target lifecycle được tách phase, không gom vào một social phase lớn.

### 4.3. Loại bỏ hoặc hoãn

- Không rename hàng loạt `sender_id` thành `actor_id`; `sender_id` tiếp tục là alias legacy.
- Không dùng Redis làm nguồn sự thật unread.
- Không thêm TTL/physical delete notification trong phạm vi này.
- Không triển khai push, public group invitation/self-join hoặc frontend.

## 5. Nguyên tắc chia phase

- Mỗi phase chỉ mở một boundary kiến trúc hoặc tối đa hai hành vi liên quan chặt.
- Database chỉ phục vụ local/test: khi schema/index mới xung đột dữ liệu cũ, reset collection hoặc toàn database trước khi bootstrap; không viết migration để giữ dữ liệu cũ.
- Không tạo thư mục/file `migrations`, không backfill, archive, dry-run, resume hoặc dual-write chỉ để chuyển dữ liệu local cũ.
- Schema/index mới được khai báo trực tiếp trong schema và `database.service.ts`; startup fail-fast nếu database chưa được reset đúng.
- Backend security/data/idempotency gate phải hoàn thành trước feature handler phụ thuộc.
- Giữ service facade, REST path và socket event legacy cho tới khi frontend áp dụng contract mới; dữ liệu cũ không thuộc compatibility guarantee.
- Không dùng mock để đi qua gate outbox, aggregation hoặc unread.
- Không tự cài test framework. Mỗi phase dùng `npx tsc --noEmit`, `npm run build`, targeted ESLint và API/socket scripts hoặc test thủ công. Việc dựng test runner là quyết định riêng.
- Worktree hiện có thay đổi conversation chưa commit; khi triển khai phải preserve và chia commit theo release milestone ở cuối tài liệu.

## Bước chuẩn bị — Khóa baseline, chưa triển khai

**Mục đích:** ghi lại response/event/index/data mẫu hiện tại trước Phase 1, không thay source.

**Công việc:**

1. Chụp JSON của ba endpoint notification với zero/one/many item và cursor.
2. Chụp payload `@notification:new`, `@conversation:receive`, `@message:reaction-updated`, `@conversation:group-updated`.
3. Ghi số lượng/shape legacy notification và kiểm tra index thực tế bằng `listIndexes()`.
4. Chuẩn bị A/B/C: direct A-B; group A/B/C; A admin; ít nhất hai socket cho cùng user.
5. Ghi `git status` và không ghi đè thay đổi conversation hiện có.

**Gate:** baseline artifact đủ để so sánh backward compatibility; chưa phase nào được đánh dấu hoàn thành.

---

## Phase 1 — Vòng đời MongoDB dùng chung và bootstrap index

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Loại bỏ MongoClient theo socket/service và bảo đảm notification/conversation index được kiểm tra idempotent khi startup.

**Phạm vi chức năng**

1. Một `DatabaseService`/MongoClient dùng chung cho process.
2. Bootstrap từng nhóm index không bị return sớm vì một index khác đã tồn tại.

**Phụ thuộc**

- Phụ thuộc Bước chuẩn bị để so sánh startup/index.
- Tất cả phase database/outbox/unread về sau phụ thuộc Phase 1.

**File tạo mới**

- Không có; ưu tiên sửa lifecycle hiện tại thay vì tạo container DI mới.

**File sửa**

- `src/config/database.service.ts`: dùng một shared/static MongoClient pool cho mọi wrapper instance, public `createNotificationIndexes()` và kiểm tra/tạo từng index độc lập.
- `src/socket/index.ts`: nhận/reuse database service dùng chung khi đăng ký chat handler.
- `src/socket/chat.handler.ts`: bỏ `new DatabaseService()` theo socket, nhận dependency.
- `src/modules/notification/notification.service.ts`: nhận singleton/dependency thay vì tự tạo client.
- `src/modules/conversation/conversation.service.ts`, `conversation-access.service.ts`, `conversation-message-access.service.ts`, `conversation-message-hydration.service.ts`: dùng cùng dependency mà không tạo pool riêng.
- `src/modules/tweet/tweet.service.ts`, `src/modules/user/user.route.ts`: dùng instance dùng chung.
- `src/app.ts`: connect một lần, gọi `createConversationIndexes()` và `createNotificationIndexes()` trước khi nhận traffic; không kéo index module không liên quan vào cùng gate.

**Schema và index**

- Chưa đổi schema.
- Giữ index hiện có; sửa bootstrap để xác nhận riêng `recipient_id_1_created_at_-1` và `recipient_id_1_is_read_1`.
- Không drop index trong phase này.

**Luồng xử lý sau phase**

```text
app bootstrap → databaseService.connect() → ensure indexes → init Socket/HTTP
socket connection → chatHandler(shared databaseService)
```

**Quy tắc nghiệp vụ và edge case**

- Startup hai instance đồng thời không lỗi vì createIndex idempotent.
- Redis connect/Socket init chỉ chạy sau database/index gate.
- Disconnect một socket không đóng MongoClient chung.
- Startup fail index phải fail-fast, không chạy server với index thiếu.

**Tương thích và dữ liệu local**

- Không đổi endpoint, response, schema hoặc socket payload.
- Không cần reset dữ liệu ở phase này.

**Kiểm thử**

- Start/stop backend hai lần; chạy hai process vào cùng DB test.
- Kiểm tra số MongoClient/pool không tăng theo số socket.
- `npx tsc --noEmit`, build và targeted lint các file chạm.

**Gate hoàn thành**

- Mở 100 socket test không tạo 100 DatabaseService/MongoClient.
- `listIndexes()` có đủ hai index notification hiện tại.
- Startup lần hai không throw duplicate-index hoặc treo trước listen.

**Rollback**

- Revert dependency injection/singleton wiring; index đã tạo được giữ vì tương thích và không phá dữ liệu.

---

## Phase 2 — Khóa REST notification legacy và pagination đúng

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Làm REST hiện tại deterministic, typed và an toàn trước khi schema/worker thay đổi.

**Phạm vi chức năng**

1. Validator/default/cursor/ID đúng.
2. Pagination `limit + 1` và mark-read idempotent theo recipient.

**Phụ thuộc**

- Phase 1 bảo đảm DB/index ổn định.
- Phase 3–4 dựa trên contract đã khóa ở phase này.

**File tạo mới**

- `src/modules/notification/notification.validator.ts`: validator riêng cho cursor/limit và notification id.

**File sửa**

- `src/modules/notification/notification.route.ts`: dùng validator riêng, giữ route order/path.
- `src/modules/notification/notification.controller.ts`: đọc `req.validatedData`, bỏ `Number(undefined)` và `any` không cần thiết.
- `src/modules/notification/dto/index.ts`: type response legacy chính xác.
- `src/modules/notification/notification.service.ts`: lấy `limit + 1`, idempotent mark-one/read-all.
- `endpoint.md`, `swagger.yaml`: mô tả query/default/response thật.

**Schema và index**

- Chưa thêm field/index.
- Cursor legacy tiếp tục là ObjectId và sort `_id` trong phase này; Phase 3 mới dual-read cursor tuple.

**Luồng xử lý sau phase**

```text
route validator → validatedData → controller → query limit+1 → slice limit → exact has_next_page
```

**Quy tắc nghiệp vụ và edge case**

- Không truyền limit dùng default 10.
- ObjectId invalid trả 400, không thành 500.
- Mark notification đã read trả success idempotent, không coi `modifiedCount=0` là thất bại nếu document thuộc recipient.
- ID không tồn tại/không thuộc recipient trả 404 mà không lộ owner.
- Read-all lúc không có unread trả updatedCount 0.

**Tương thích và dữ liệu local**

- Giữ nguyên ba REST path và các field `notifications`, `unreadCount`, `next_cursor`, `has_next_page`.
- Chỉ sửa correctness; frontend hiện tại không phải đổi.

**Kiểm thử**

- API test không limit, limit 1/100/101, cursor invalid, exact page size và page cuối.
- Test A không mark được notification của B.
- Typecheck/build/targeted lint.

**Gate hoàn thành**

- GET không query trả tối đa 10 item và không 500.
- 10 item tổng với limit 10 trả `has_next_page=false`.
- ID invalid trả 400; foreign ID và missing ID không làm đổi document.

**Rollback**

- Revert validator/service changes; phase này không yêu cầu giữ hoặc chuyển đổi dữ liệu local.

---

## Phase 3 — Notification schema v2 và index additive

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Mở rộng data model đủ cho target typing, dedupe, aggregation và lifecycle trên database local sạch, đồng thời vẫn giữ các field REST legacy cho frontend.

**Phạm vi chức năng**

1. Schema v2 additive.
2. Stable tuple pagination và index tương ứng.

**Phụ thuộc**

- Phase 2 đã khóa REST behavior.
- Repository, domain event và aggregation các phase sau phụ thuộc schema/index này.

**File tạo mới**

- `src/modules/notification/notification-cursor.ts`: encode/decode opaque cursor `{created_at,_id}` và dual-read ObjectId cursor legacy.

**File sửa**

- `src/schemas/Notification.schema.ts`: thêm field v2, giữ field legacy/default an toàn.
- `src/constants/enums/notification.enum.ts`: chỉ bổ sung target/type cần sớm, không xóa enum cũ.
- `src/config/database.service.ts`: indexes v2 được ensure độc lập.
- `src/modules/notification/notification.service.ts`: sort/query tuple và filter `invalidated_at` nếu có.
- `src/modules/notification/dto/index.ts`, `endpoint.md`, `swagger.yaml`: field additive/cursor opaque.

**Schema và index**

Field thêm: `target_type`, `actor_ids_preview`, `actor_count`, `context`, `deduplication_key`, `aggregation_key`, `aggregation_active`, `read_at`, `updated_at`, `invalidated_at`.

Index thêm:

```text
{ recipient_id: 1, created_at: -1, _id: -1 }
{ deduplication_key: 1 } unique partial khi field là string
{ target_type: 1, target_id: 1 }
```

- Chưa tạo aggregate-active index hoặc NotificationActor; Phase 10 sở hữu.
- Document mới được ghi trực tiếp theo schema v2 và vẫn populate các field public legacy cần thiết.
- Nếu notification local cũ không thỏa schema/index mới, reset collection trước bootstrap; không normalize hoặc chuyển đổi document cũ trong request path.

**Luồng xử lý sau phase**

```text
GET notifications → decode cursor được hỗ trợ → query immutable tuple → map schema v2 → response legacy + additive fields
```

**Quy tắc nghiệp vụ và edge case**

- Concurrent notification mới không làm page cũ duplicate do cursor tuple.
- `updated_at` thay đổi không ảnh hưởng sort.
- Invalidated record không xuất hiện và không được tính unread.
- Unique partial index áp dụng an toàn cho document v2 có dedup key; local DB phải được reset nếu dữ liệu test cũ gây xung đột index.

**Tương thích và dữ liệu local**

- `sender_id`, `target_id`, `is_read`, `created_at` luôn còn.
- Cursor 24-hex cũ vẫn được nhận; `next_cursor` mới được coi opaque.
- Không đổi `@notification:new` trong phase này.

**Kiểm thử**

- Seed v2, paginate không thiếu/trùng; bootstrap lại trên database local đã reset.
- Update `updated_at` giữa lúc paginate không đổi thứ tự.
- Sau khi reset local, bootstrap index hai lần liên tiếp không fail và không tạo index trùng.

**Gate hoàn thành**

- Tải toàn bộ 3 page khi đồng thời insert notification mới không duplicate `_id`.
- Document v2 trả đủ field REST cũ và additive fields.
- Index explain dùng compound recipient/created/id.

**Rollback**

- Revert code về cursor legacy và reset notification local nếu schema/index không còn tương thích.

---

## Phase 4 — Tách repository, query/policy và realtime delivery

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Tách trách nhiệm đang dồn trong `notification.service.ts` trước khi business module publish event.

**Phạm vi chức năng**

1. Repository/query typed.
2. Policy và Socket delivery có boundary riêng.

**Phụ thuộc**

- Phase 3 cung cấp schema/cursor.
- Phase 5–17 dùng các boundary này.

**File tạo mới**

- `src/modules/notification/notification.repository.ts`: create/find/read/invalidate primitives có session option.
- `src/modules/notification/notification-query.service.ts`: pagination, normalization và actor/target hydration public.
- `src/modules/notification/notification-policy.service.ts`: self/block/recipient/precedence decisions; phase này mới dựng interface và legacy policy.
- `src/modules/notification/notification-delivery.service.ts`: personal-room Socket.IO emit sau persistence.
- `src/modules/notification/notification.type.ts`: internal command/result/target/context types.

**File sửa**

- `src/modules/notification/notification.service.ts`: trở thành facade orchestration tương thích.
- `src/modules/notification/notification.controller.ts`: gọi query/facade typed.
- `src/modules/notification/dto/index.ts`: map public actor/target projection, không trả user document nhạy cảm.
- `src/modules/user/user.service.ts`, `src/modules/tweet/tweet.service.ts`, `src/socket/chat.handler.ts`: caller vẫn dùng facade; chỉ bảo đảm facade signature cũ còn dùng được.

**Schema và index**

- Không đổi schema/index.
- Repository phải chấp nhận optional `ClientSession` để Phase 6/9 dùng transaction.

**Luồng xử lý sau phase**

```text
legacy caller → NotificationService facade → policy → repository → delivery
GET → query service → public hydration
```

**Quy tắc nghiệp vụ và edge case**

- Repository không import Socket.IO.
- Delivery không import business services hoặc tự query block.
- Query chỉ hydrate `_id/name/username/avatar` và target preview tối thiểu.
- Actor bị thiếu không crash; trả `actor_info=null`/target unavailable.
- Emit lỗi không rollback notification đã persist.

**Tương thích và dữ liệu local**

- `createNotification(recipient,sender,type,target?)` facade và `@notification:new` giữ nguyên.
- Raw legacy fields tiếp tục có trong REST/socket.

**Kiểm thử**

- Exercise facade với getIO unavailable: DB insert thành công, delivery log lỗi có context.
- A/B nhận đúng personal room; hai tab A nhận cùng `_id`.
- Query không trả email/password/token.

**Gate hoàn thành**

- Không file mới nào vừa persist vừa emit vừa resolve business recipient.
- Tất cả caller cũ vẫn compile và payload `@notification:new` giữ field legacy.

**Rollback**

- Facade có thể inline lại behavior cũ; schema Phase 3 không phụ thuộc boundary code.

---

## Phase 5 — Typed domain event và handler idempotent đồng bộ

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Định nghĩa event contract có `event_id` và chứng minh handler idempotent trước khi thêm queue/outbox.

**Phạm vi chức năng**

1. Typed domain-event registry/publisher interface.
2. Notification event handler dùng deduplication key.

**Phụ thuộc**

- Phase 4 có repository/policy/delivery.
- Phase 6 outbox và mọi business handler chuyển sang pipeline mới phụ thuộc event contract này.

**File tạo mới**

- `src/modules/events/domain-event.type.ts`: discriminated union và envelope chung.
- `src/modules/events/domain-event.publisher.ts`: interface + inline publisher tạm cho kiểm chứng.
- `src/modules/notification/notification-event.handler.ts`: dispatch typed event sang policy/repository.
- `src/modules/notification/notification-event.type.ts`: notification intents/result, không trùng domain event.

**File sửa**

- `src/modules/notification/notification.service.ts`: facade có thể chuyển legacy call thành legacy intent; business caller chưa bắt buộc đổi ngay.
- `src/modules/notification/notification.repository.ts`: `createIndividualNotification()` dùng dedup key/duplicate-key recovery.
- `src/constants/enums/notification.enum.ts`: bổ sung type mới theo backward-compatible string values.

**Schema và index**

- Dùng unique partial `deduplication_key` Phase 3.
- Chưa tạo outbox collection.

**Luồng xử lý sau phase**

```text
typed event → inline publisher → notification event handler → policy → idempotent repository → delivery
```

**Quy tắc nghiệp vụ và edge case**

- `event_id`, actor, occurred_at và source id bắt buộc trong typed event.
- Cùng dedup key chỉ tạo một notification dù handler chạy lại.
- Duplicate-key race phải load/return document hiện có, không trả 500.
- Delivery chỉ chạy cho kết quả `created/meaningfully_updated`; retry no-op không emit new lần nữa.

**Tương thích và dữ liệu local**

- Chưa loại direct caller cũ.
- Inline publisher chỉ là bridge; Phase 6 thay implementation bằng outbox mà không đổi business event type.

**Kiểm thử**

- Gọi cùng event ba lần tuần tự và đồng thời.
- Handler crash/retry sau repository insert.
- Unknown event type đi dead-letter/error rõ, không silently ignore.

**Gate hoàn thành**

- Ba lần cùng `event_id`/dedup key tạo đúng một document và tối đa một `@notification:new` trong execution bình thường.
- Hai process xử lý đồng thời không tạo duplicate.

**Rollback**

- Business caller vẫn dùng facade legacy; có thể disable inline publisher mà không mất REST data.

---

## Phase 6 — Transactional outbox và BullMQ notification worker

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Loại bỏ cửa sổ mất event giữa business commit và notification processing, đồng thời có retry/backoff/dead-letter.

**Phạm vi chức năng**

1. Outbox persistence/publisher có lease.
2. BullMQ worker dùng handler idempotent Phase 5.

**Phụ thuộc**

- Phase 1 shared MongoClient/session.
- Phase 5 typed/idempotent handler.
- **Cần xác minh transaction trước khi triển khai Phase 6** như mục 2.4.
- Phase 7 trở đi mới chuyển business mutation sang outbox.

**File tạo mới**

- `src/schemas/OutboxEvent.schema.ts`.
- `src/modules/events/outbox.repository.ts`: insert/claim/lease/status/replay primitives.
- `src/modules/events/outbox.publisher.ts`: poll pending, enqueue job idempotent.
- `src/queues/notification.queue.ts`: queue name, attempts 8, exponential backoff, retention.
- `src/modules/notification/notification.worker.ts`: load event và gọi handler.

**File sửa**

- `src/schemas/index.ts`: export OutboxEvent.
- `src/config/getEnvConfig.ts`: collection outbox và feature flag `NOTIFICATION_OUTBOX_ENABLED` mặc định false khi rollout.
- `src/config/database.service.ts`: accessor/index outbox.
- `src/config/redisConfig.ts`: reuse BullMQ connection, không tạo loại client thứ ba tùy tiện.
- `src/app.ts`: start publisher/worker sau DB+Redis, shutdown graceful.
- `package.json`: chỉ thêm script vận hành/replay nếu không cần package mới.

**Schema và index**

Outbox fields theo mục 3.10.

```text
{ event_id: 1 } unique
{ status: 1, available_at: 1, locked_at: 1 }
{ aggregate_type: 1, aggregate_id: 1, occurred_at: 1 }
```

- Không TTL pending/failed event.
- Processed event chỉ được purge bằng maintenance sau retention đã chốt ở Phase 18.

**Luồng xử lý sau phase**

```text
transaction writes outbox → publisher lease → queue(jobId=event_id) → worker transaction(handler persist + mark processed) → commit → emit
```

**Quy tắc nghiệp vụ và edge case**

- Enqueue thành công/mark published thất bại không tạo job thứ hai.
- Worker retry trước transaction commit không tạo notification/count trùng.
- Socket emit thất bại sau commit không chuyển business event về pending; REST reconcile vẫn thấy notification.
- Worker vượt attempts chuyển outbox `dead_letter` với last_error và có đường replay thủ công.
- Shutdown ngừng claim mới, đợi job hiện tại trong timeout rồi release lease.

**Tương thích và dữ liệu local**

- Feature flag mặc định off; chưa business path nào bắt buộc phụ thuộc queue.
- `@notification:new` và REST không đổi.

**Kiểm thử**

- Transaction smoke test fail/pass rõ ràng.
- Kill publisher giữa enqueue/mark; kill worker sau persist/trước processed.
- Redis down/recover; Mongo transient error; retry/dead-letter/replay.
- Typecheck/build và start/stop graceful.

**Gate hoàn thành**

- Event pending trước restart được xử lý sau restart.
- Cùng event job chạy ba lần chỉ tạo một notification/unread transition.
- Event lỗi đủ 8 attempts xuất hiện dead_letter và replay được bằng event_id.

**Rollback**

- Tắt `NOTIFICATION_OUTBOX_ENABLED`; giữ outbox documents để replay sau. Không drop collection/index/queue.

---

## Phase 7 — Follow notification đúng nghiệp vụ

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Chuyển Follow sang transaction + outbox và đóng self/block/concurrency gaps.

**Phạm vi chức năng**

1. `UserFollowed` event/notification.
2. Suppress đúng self, existing relation, unfollow-before-worker và block hai chiều.

**Phụ thuộc**

- Phase 6 outbox hoạt động.
- Phase 16 dùng Follower relation đã an toàn để thêm preference.

**File tạo mới**

- Không có; thêm event variant/policy vào file Phase 5.

**File sửa**

- `src/modules/user/user.service.ts`: self guard; follower insert, counters và outbox trong transaction/session.
- `src/modules/notification/notification-policy.service.ts`: resolve Follow recipient và recheck relation/block tại worker time.
- `src/modules/notification/notification-event.handler.ts`: xử lý UserFollowed.
- `src/schemas/Follower.schema.ts`: bảo đảm relation `_id`/timestamp làm source id; chưa thêm preference.
- `src/constants/messages.ts`: error self-follow ổn định nếu cần.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Giữ unique follower index `{follow_user_id, followed_user_id}`.
- Notification dedup key: `recipient:FOLLOW:follower_relation_id`.
- Không xóa notification lịch sử khi unfollow; unfollow không tạo notification mới.

**Luồng xử lý sau phase**

```text
follow transaction → relation + counters + UserFollowed outbox → worker recheck block/relation → notification
```

**Quy tắc nghiệp vụ và edge case**

- Self-follow bị chặn trước insert/counter.
- Hai request follow đồng thời chỉ một relation/event; request thua giữ conflict contract hiện tại.
- Nếu unfollow hoặc block trước worker xử lý, handler suppress pending follow notification.
- Nếu notification đã được giao rồi mới unfollow, giữ lịch sử; block cleanup ở Phase 17.
- Notification insert lỗi không làm API follow rollback sau khi business transaction commit; event retry độc lập.

**Tương thích và dữ liệu local**

- Follow endpoint/response hiện tại không đổi.
- Xóa direct `notificationService.createNotification()` khỏi Follow sau khi outbox flag được bật và shadow comparison pass.

**Kiểm thử**

- Self, existing, concurrent follow, block hai chiều, follow-unfollow nhanh, worker retry.
- So counters/relation/notification sau injected failure.

**Gate hoàn thành**

- Self-follow không tạo relation/counter/event.
- 20 concurrent requests tạo một relation và một notification.
- Relation bị xóa trước worker không tạo notification.

**Rollback**

- Feature flag Follow handler về legacy facade; outbox event tồn tại nhưng handler có thể pause. Guard self/index vẫn giữ.

---

## Phase 8 — Reply, Quote và Mention tweet cá nhân

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Đưa tweet interaction cá nhân qua một event/policy, normalize mention và áp precedence thống nhất.

**Phạm vi chức năng**

1. Reply/Quote individual notification.
2. Mention create/edit reconciliation và dedupe với Reply/Quote.

**Phụ thuộc**

- Phase 6 event reliability.
- Phase 7 chứng minh transaction/outbox pattern.
- Phase 10 bổ sung aggregate Like/Repost; Phase 17 xử lý delete/block lifecycle toàn diện.

**File tạo mới**

- `src/modules/tweet/tweet-mention.service.ts`: parse/normalize/dedupe username và explicit ObjectId theo string; không biết notification.

**File sửa**

- `src/modules/tweet/tweet.service.ts`: business transaction ghi Tweet + parent counters/feed + `TweetCreated`/`TweetMentionsChanged` outbox; bỏ direct notification cho các intent đã chuyển sang pipeline mới.
- `src/modules/tweet/tweet.validator.ts`: normalize explicit mention IDs; giữ request contract.
- `src/modules/notification/notification-policy.service.ts`: Quote > Reply > Mention, self/block/privacy.
- `src/modules/notification/notification-event.handler.ts`: individual tweet intents/invalidation mention removed.
- `src/constants/enums/notification.enum.ts`, `src/modules/notification/notification.type.ts`.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Individual dedup key: `recipient:type:TWEET:child_tweet_id`.
- `target_type=TWEET`, `target_id=child tweet`; context có `parent_tweet_id` và `mentioned`.
- Không aggregation.

**Luồng xử lý sau phase**

```text
create/update tweet transaction → TweetCreated/TweetMentionsChanged → policy precedence → individual notification/invalidate removed mention
```

**Quy tắc nghiệp vụ và edge case**

- Mention lặp/mixed ObjectId-string chỉ một recipient.
- Username không tồn tại bị bỏ, không fail toàn tweet.
- Self mention/self reply/self quote không notification.
- Block hai chiều suppress dù caller direct API vượt feed UI.
- Reply owner đồng thời mention chỉ Reply; Quote owner đồng thời mention chỉ Quote.
- Mention edit: additions tạo item idempotent; removals invalidate đúng Mention item; không tạo notification “unmentioned”.
- Retweet không content không chạy mention.

**Tương thích và dữ liệu local**

- Tweet endpoints/response giữ nguyên.
- Notification legacy `type`, `sender_id`, `target_id` vẫn được populate.

**Kiểm thử**

- Tweet/reply/quote mention nhiều lần, explicit+text, nonexistent, self, blocked.
- Concurrent duplicate create retry cùng outbox event.
- Edit add/remove mention và precedence owner.

**Gate hoàn thành**

- Một reply mention parent owner 3 lần tạo đúng một Reply, `context.mentioned=true`.
- Mention khác owner nhận đúng một Mention.
- Edit bỏ mention làm item đó biến khỏi list và unread count hiện tại vẫn theo behavior trước Phase 9 (countDocuments).

**Rollback**

- Bật lại legacy tweet facade theo feature flag; dữ liệu v2 additive giữ nguyên. Không replay đồng thời hai handler.

---

## Phase 9 — Notification unread state và đồng bộ multi-device

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Biến unread count thành state có version, cập nhật nguyên tử với notification và đồng bộ mark-read giữa tab/device.

**Phạm vi chức năng**

1. NotificationState khởi tạo trên database local sạch.
2. Mark-one/read-all/unread-count realtime.

**Phụ thuộc**

- Phase 3 schema, Phase 4 repository, Phase 6 transaction.
- Phase 10 aggregation phụ thuộc read transition đã đúng.

**File tạo mới**

- `src/schemas/NotificationState.schema.ts`.
- `src/modules/notification/notification-unread.service.ts`: conditional increment/decrement/version.

**File sửa**

- `src/schemas/index.ts`, `src/config/getEnvConfig.ts`, `src/config/database.service.ts`: collection/accessor/index.
- `src/modules/notification/notification.repository.ts`: persist/invalidate + state trong cùng transaction.
- `src/modules/notification/notification.service.ts`, controller/route/validator/DTO: read mutation và `GET /unread-count`.
- `src/modules/notification/notification-delivery.service.ts`: emit count/read state.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

```text
NotificationState { recipient_id, unread_count, version, updated_at }
{ recipient_id: 1 } unique
```

- Trước khi bật state, xóa dữ liệu local trong `notifications`, `notificationStates` và `notificationActors`; notification mới sẽ tạo state nguyên tử từ `0`.
- Notification unread partial index được thêm/ensure:

```text
{ recipient_id: 1, is_read: 1, created_at: -1 }
partial invalidated_at absent/null
```

**Luồng xử lý sau phase**

```text
persist new item + state increment (transaction) → commit → @notification:new raw + @notification:unread-count
mark read → conditional update + decrement/version → commit → @notification:read-state
```

**Quy tắc nghiệp vụ và edge case**

- Mark-one chỉ decrement khi `is_read` thật sự chuyển false→true.
- Read-all chụp cutoff thời gian/id và trong transaction chỉ mark item tới cutoff; item đến sau không bị mất unread.
- Read-all decrement theo `modifiedCount`, không blind-set 0.
- Concurrent worker/read mutation phải retry transaction/write conflict.
- State không âm; mismatch có reconciliation command từ Mongo source truth.
- Socket failure không ảnh hưởng persisted state; reconnect gọi GET list hoặc unread-count.

**Tương thích và dữ liệu local**

- Giữ `@notification:new` raw payload.
- Thêm `@notification:unread-count` và `@notification:read-state`; không đổi event cũ.
- GET list tiếp tục trả `unreadCount` từ `NotificationState`; không có giai đoạn backfill/fallback để giữ notification cũ.

**Kiểm thử**

- Multi-tab mark one/all; new notification race với read-all.
- Hai worker insert đồng thời; invalidate unread; reset local rồi bootstrap lại state/index.
- Kill emit/reconnect/refetch.

**Gate hoàn thành**

- 100 concurrent inserts tạo unread_count 100; đọc cùng item hai lần chỉ giảm một.
- Read-all đồng thời item mới kết thúc với item mới vẫn unread.
- Hai tab nhận cùng version/count; reconnect trả count giống DB.

**Rollback**

- Tắt feature flag và reset `notifications`/`notificationStates` nếu cần quay lại path cũ; không bảo toàn unread local cũ.

---

## Phase 10 — Aggregation Like/Repost và undo reconciliation

**Trạng thái: Đã hoàn thành**

**Mục tiêu**

Gom Like/Repost theo window, chống race/retry và reconcile unlike/undo chính xác.

**Phạm vi chức năng**

1. NotificationActor + aggregate repository.
2. TweetLiked/Unliked/Reposted/UndoRepost handlers.

**Phụ thuộc**

- Phase 9 unread state và Phase 6 outbox.
- Phase 17 target/user lifecycle sử dụng actor edges này.

**File tạo mới**

- `src/schemas/NotificationActor.schema.ts`.
- `src/modules/notification/notification-aggregation.service.ts`.

**File sửa**

- `src/schemas/index.ts`, `src/config/getEnvConfig.ts`, `src/config/database.service.ts`.
- `src/modules/tweet/tweet.service.ts`: like/unlike/repost/undo ghi outbox cùng source mutation; trả source relation id cho undo event.
- `src/modules/notification/notification-event.handler.ts`, repository, policy, query, delivery.
- `src/constants/enums/notification.enum.ts`, `endpoint.md`, `swagger.yaml`.

**Schema và index**

```text
NotificationActor { notification_id, actor_id, source_key, last_event_id, context, created_at, updated_at }
{ notification_id: 1, actor_id: 1 } unique
{ notification_id: 1, created_at: -1 }
{ source_key: 1, created_at: -1 }

notifications:
{ recipient_id: 1, aggregation_key: 1 } unique partial aggregation_active=true

tweets:
{ user_id: 1, parent_id: 1, type: 1 } unique partial type=Retweet
```

**Luồng xử lý sau phase**

```text
Like/Repost source transaction → outbox → aggregate window/actor edge + unread state → @notification:new hoặc @notification:updated
Unlike/Undo → remove edge → decrement/invalidate → @notification:updated/removed
```

**Quy tắc nghiệp vụ và edge case**

- Self-like/repost không notification.
- Retry/duplicate source không tăng actor count.
- Hai actor đồng thời tăng đúng hai.
- Same actor đổi cycle unlike/re-like có source key mới và vào active window hiện tại.
- Aggregate read đóng window; actor event sau read tạo item mới/unread +1.
- Undo chỉ tác động active/latest edge chứa đúng source key; count 0 invalidate.
- Actor preview không quá 3 và bỏ actor bị block/unavailable khi query.

**Tương thích và dữ liệu local**

- Trước khi bật aggregation, reset notification/actor/state local; không merge notification Like/Repost cũ trong request path.
- Trước khi tạo unique repost index, xóa/reset Retweet relation trùng trong local database; không archive hoặc giữ relation cũ.
- `@notification:updated`/`removed` là event mới; `@notification:new` dùng cho window mới.

**Kiểm thử**

- Race 100 likes, retry cùng event, unlike lặp, undo repost lặp, read/new actor.
- Reset database local, bootstrap index hai lần và xác nhận unique repost index idempotent.
- Verify unread count từng transition.

**Gate hoàn thành**

- 100 actor đồng thời cho một tweet tạo một active aggregate, actor_count 100, preview ≤3 và unread +1.
- Unlike 1 actor hai lần làm count giảm đúng một.
- Read aggregate rồi actor mới tạo window thứ hai và unread +1.

**Rollback**

- Pause aggregate handlers và tạm route event sang individual handler; có thể xóa `notificationActors`/aggregate notification local. Unique repost relation vẫn được giữ vì sửa correctness nguồn.

---

## Phase 11 — Hợp nhất mọi đường tạo Message và idempotency

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Đưa send/forward qua cùng command pipeline trước khi thêm unread và directed notification.

**Phạm vi chức năng**

1. Message command service dùng chung.
2. `client_message_id`/`client_operation_id` chống retry.

**Phụ thuộc**

- Phase 1 DB lifecycle, Phase 5 event contract, Phase 6 outbox.
- Phase 12–15 phụ thuộc command pipeline.

**File tạo mới**

- `src/modules/conversation/conversation-message-command.service.ts`: validate access/media/reply, persist message/update conversation/outbox.
- `src/modules/conversation/conversation-message-delivery.service.ts`: cache hydrated message và emit personal rooms sau commit.

**File sửa**

- `src/socket/chat.handler.ts`: thin adapter parse payload, gọi command, ack/emit theo result.
- `src/modules/conversation/conversation.service.ts`: `forwardMessage()` gọi command cho từng target thay vì insertMany riêng.
- `src/modules/conversation/conversation.controller.ts`, validator/DTO: optional `client_operation_id` cho forward.
- `src/schemas/Message.schema.ts`: optional `client_message_id`, `origin_message_id`, `is_forwarded` typed.
- `src/config/database.service.ts`: unique partial message idempotency index.
- `src/modules/conversation/conversation-message-hydration.service.ts`, `conversation-message-sync.service.ts` nếu cần payload/cache chung.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

```text
Message.client_message_id?: string
{ sender_id: 1, client_message_id: 1 } unique partial khi client_message_id tồn tại
```

- Existing message local có thể bị xóa; không backfill field idempotency cho document cũ.
- Forward derived key: `client_operation_id:target_conversation_id`.

**Luồng xử lý sau phase**

```text
socket send/REST forward → MessageCommand → transaction message+conversation+outbox → commit → cache/delivery → existing ack/response
```

**Quy tắc nghiệp vụ và edge case**

- Recheck membership/block ngay trước insert như code hiện tại.
- Retry same client id trả stored message id, `created=false`; không broadcast/outbox lần hai.
- Forward target list dedupe; all access/block validated trước first write hoặc transaction rollback toàn bộ.
- Redis/cache/emit chỉ sau commit; cache failure không rollback message.
- Sender luôn được coi read cho message họ tạo, kể cả forward.

**Tương thích và dữ liệu local**

- `@conversation:send`, ack `{success,message_id}`, `@conversation:receive` và forward REST path/shape giữ nguyên.
- `client_message_id` optional cho client cũ. Không tuyên bố dedupe cho payload thiếu key.
- Generic legacy Message notification tạm giữ tới Phase 13.

**Kiểm thử**

- Send/forward direct/group, media/reply, block, member removed race.
- Retry cùng client id 3 lần; concurrent duplicate.
- Inject transaction/cache/socket failure.

**Gate hoàn thành**

- Send và forward đều tạo hydrated realtime payload/correct cache/preview.
- Cùng client id tạo một message/outbox/unread-placeholder event.
- Không còn `new Message()` production path ngoài command service/test fixtures.

**Rollback**

- Giữ index/field additive; route send/forward có thể feature-flag về path cũ trong một release, không chạy song song hai writer.

---

## Phase 12 — Conversation read-state và inbox badge

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Thay scan/update message làm nguồn unread bằng read position/counter theo conversation và summary theo user.

**Phạm vi chức năng**

1. ConversationReadState + UserMessageState trên database local sạch.
2. Read acknowledgement và unread summary REST/socket.

**Phụ thuộc**

- Phase 11 message command transaction.
- **Cần xác minh giới hạn group trước Phase 12** như mục 2.4.
- Phase 13–15 dùng read model này.

**File tạo mới**

- `src/schemas/ConversationReadState.schema.ts`.
- `src/schemas/UserMessageState.schema.ts`.
- `src/modules/conversation/conversation-read.service.ts`.

**File sửa**

- `src/schemas/index.ts`, `src/config/getEnvConfig.ts`, `src/config/database.service.ts`.
- `src/modules/conversation/conversation-message-command.service.ts`: update per-recipient read state + user summary trong message transaction.
- `src/modules/conversation/conversation.service.ts`: `getConversations()` join read state; `markAsRead(user,conversation,message?)`.
- controller/route/validator/DTO: optional message id và `GET /conversations/unread-summary`.
- `src/socket/chat.handler.ts`: nhận `@conversation:read` acknowledgement.
- `src/modules/conversation/conversation-message-delivery.service.ts`: emit `@conversation:read-state` tới personal room actor.
- `src/schemas/Message.schema.ts`: path mới không đọc hoặc dual-write `read_by`.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

```text
ConversationReadState:
{ conversation_id, conversation_type, user_id, last_read_message_id, last_read_at, unread_message_count, created_at, updated_at }
{ conversation_id: 1, user_id: 1 } unique
{ user_id: 1, unread_message_count: 1 }

UserMessageState:
{ user_id, unread_conversation_count, total_unread_message_count, version, updated_at }
{ user_id: 1 } unique
```

- Trước khi bật Phase 12, reset message/conversation read-state local để mọi counter bắt đầu từ dữ liệu mới nhất quán; sender message luôn không unread.
- `read_by` không dùng để tính badge và không dual-write.

**Luồng xử lý sau phase**

```text
MessageCommand transaction → increment recipient conversation state + user summary
read ack(message_id/latest) → set read position/count 0 + decrement summary → @conversation:read-state
```

**Quy tắc nghiệp vụ và edge case**

- Sender không tăng unread.
- Nếu count trước message là 0, tăng unread_conversation_count; mọi message tăng total unread.
- Mark read chỉ tới message id visible/thuộc conversation; message đến sau vẫn unread.
- Read ack đến trước event processing không thể xảy ra vì unread được commit cùng message; concurrent transactions retry conflict.
- User đang mở conversation vẫn nhận unread trước, rồi frontend ack message; Redis presence không là nguồn truth.
- Removed member không nhận increment; history cutoff không làm count message cũ quay lại.
- Summary không âm; có reconciliation command.

**Tương thích và dữ liệu local**

- Existing `POST /conversations/:id/read` body rỗng vẫn mark tới latest.
- `GET /conversations` chỉ thêm field unread.
- Thêm endpoint/event; field `read_by` có thể giữ trong schema để đọc payload legacy nhưng dữ liệu local cũ không được bảo toàn.

**Kiểm thử**

- Direct/group concurrent sends, open conversation ack, multi-tab, history clear, removed member.
- Reset local rồi bootstrap schema/index/read-state hai lần.
- Group tại giới hạn member đã chốt.

**Gate hoàn thành**

- 3 conversation unread trả badge 3 dù có 100 total messages.
- Per-conversation counts cộng đúng total; read một conversation giảm summary đúng.
- Không query/update toàn bộ messages để trả badge hoặc mark read ở path mới.

**Rollback**

- Tắt read-state path và reset collection local nếu cần quay lại; không duy trì dual-write hoặc rollback dữ liệu cũ.

---

## Phase 13 — Message Reply và Group Mention notification

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Tạo notification cá nhân cho message intent trực tiếp, đồng thời dừng dùng notification tab như bản sao của mọi message.

**Phạm vi chức năng**

1. MessageReply.
2. MessageMention với precedence và membership validation.

**Phụ thuộc**

- Phase 11 MessageCreated event/idempotency.
- Phase 12 inbox unread hoạt động để generic message không cần notification item.

**File tạo mới**

- `src/modules/conversation/conversation-message-mention.service.ts`: resolve explicit IDs + username trong group members.

**File sửa**

- `src/schemas/Message.schema.ts`: `mention_user_ids?: ObjectId[]`.
- `src/socket/chat.handler.ts`: optional `mention_user_ids` payload/validation.
- `src/modules/conversation/conversation-message-command.service.ts`: normalize mentions, publish MessageCreated context.
- `src/modules/notification/notification-policy.service.ts`, event handler/query service.
- `src/constants/enums/notification.enum.ts`: MessageReply/MessageMention; giữ Message legacy.
- `src/socket/index.ts` chỉ nếu cần đăng ký event contract, không thêm room conversation.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Message mới ghi `mention_user_ids` rõ ràng với default `[]`; reset messages local nếu document cũ không tương thích.
- Individual dedup: `recipient:MESSAGE_REPLY|MESSAGE_MENTION:MESSAGE:message_id`.
- target type Message; context conversation/reply id.

**Luồng xử lý sau phase**

```text
MessageCreated → all recipients already get inbox unread/socket
               → policy selects mention/reply recipient → individual notification
```

**Quy tắc nghiệp vụ và edge case**

- Mention chỉ user đang là group member lúc insert; self mention bỏ.
- Message mention thắng reply cho cùng recipient, context giữ reply id.
- Reply target revoked/deleted/unavailable bị command service từ chối như contract hiện tại.
- Direct/group generic message không tạo Notification document mới sau khi chuyển sang command path; mute không ảnh hưởng inbox unread.
- Mute chỉ dành cho future push/toast; directed in-app item vẫn persist.
- Block direct đã được command service chặn.

**Tương thích và dữ liệu local**

- Notification v2 vẫn populate legacy field/type cần cho frontend; không yêu cầu đọc lại generic notification local cũ sau reset.
- Dùng feature flag tắt generation generic sau khi Phase 12 gate pass; có thể reset notification history local trước khi bật path mới.
- `@conversation:receive` không đổi; directed item tiếp tục qua `@notification:new`.

**Kiểm thử**

- DM/group reply, group mention text/explicit/repeated/nonmember/self.
- Reply owner đồng thời mention; mute; retry event.
- Verify generic recipients chỉ có inbox unread, không có activity item.

**Gate hoàn thành**

- Một group message reply+mention cùng B tạo một MessageMention cho B, không thêm MessageReply/generic item.
- Thành viên khác chỉ tăng inbox unread và nhận message realtime.
- Retry không tạo directed item trùng.

**Rollback**

- Bật lại generic Message notification feature flag; field/types additive giữ nguyên. Không chạy cả generic và directed cho cùng recipient khi rollback.

---

## Phase 14 — Message Reaction aggregation

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Thông báo cho sender message khi người khác react, với change/remove/race đúng và aggregate tái dùng Phase 10.

**Phạm vi chức năng**

1. MessageReactionChanged/Removed events.
2. Aggregate reaction theo owner + message.

**Phụ thuộc**

- Phase 10 aggregation engine.
- Phase 11 outbox event path và current atomic reaction mutation.

**File tạo mới**

- Không có; mở rộng aggregation/event files hiện có.

**File sửa**

- `src/modules/conversation/conversation.service.ts`: reaction/unreaction mutation ghi outbox event cùng source state; giữ existing reaction socket sync.
- `src/modules/notification/notification-event.handler.ts`, policy, aggregation/query/delivery.
- `src/constants/enums/notification.enum.ts`: MessageReaction.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Aggregation key: `message_sender:MESSAGE_REACTED:message_id`.
- NotificationActor context giữ emoji hiện tại; logical source key ổn định theo `message_id + actor_id`, còn `last_event_id` thay đổi theo mutation.
- Dùng index/active-window Phase 10.

**Luồng xử lý sau phase**

```text
atomic reaction mutation + outbox → owner policy → aggregate actor upsert/update/remove → notification event
```

**Quy tắc nghiệp vụ và edge case**

- Self reaction không notification.
- Đổi emoji cập nhật actor context, không tăng count.
- React lặp cùng emoji là no-op event/persistence.
- Remove chỉ giảm khi actor edge tồn tại.
- Message revoked hoặc owner không còn nhìn thấy message suppress/invalidate target.
- Existing `@message:reaction-updated` tiếp tục tới member rooms độc lập notification.

**Tương thích và dữ liệu local**

- Không đổi reaction REST/socket payload hiện tại.
- Chỉ thêm activity notification type/events.

**Kiểm thử**

- React/change/remove lặp, nhiều actor đồng thời, owner self, owner delete-for-me, revoke race.
- Read aggregate/new actor window.

**Gate hoàn thành**

- Một actor đổi 3 emoji vẫn actor_count 1.
- 20 actor concurrent tạo count 20/unread item 1.
- Remove cuối cùng invalidates aggregate và điều chỉnh unread đúng một.

**Rollback**

- Pause MessageReaction notification handler; reaction nghiệp vụ/socket hiện tại không bị ảnh hưởng. Actor data giữ để replay.

---

## Phase 15 — Group system message và quyền admin

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Biểu diễn group-management event nhất quán bằng system message + direct notification cho affected user + existing realtime group event.

**Phạm vi chức năng**

1. Add/join/leave/kick system activity và direct notifications cần thiết.
2. Admin grant/revoke APIs/events.

**Phụ thuộc**

- Phase 11 command service và Phase 12 unread.
- Phase 13 notification policy/idempotency.

**File tạo mới**

- `src/modules/conversation/conversation-system-message.service.ts`: tạo typed system message qua command pipeline, không tự gửi notification generic.

**File sửa**

- `src/schemas/Message.schema.ts`: `kind: 'user'|'system'`, `system_event_type`, `affected_user_ids`, context typed; legacy default user.
- `src/modules/conversation/conversation.service.ts`: create group/add/remove/leave/transfer và admin grant/revoke transaction + outbox/system message.
- `src/modules/conversation/conversation.route.ts`, controller, validator, DTO: thêm `POST /:conversation_id/admins/:user_id` và `DELETE /:conversation_id/admins/:user_id`.
- `src/modules/conversation/conversation-message-command.service.ts`: system command mode và unread recipients.
- `src/modules/notification/notification-policy.service.ts`, event handler.
- `src/constants/enums/notification.enum.ts`, `src/constants/enums/conversation.enum.ts`.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Message mới luôn ghi `kind` rõ ràng; reset messages local thay vì lazy-default document cũ.
- Notification types giữ `GroupAdd`/`GroupJoin` legacy và thêm stable values cho GroupKick/AdminGranted/AdminRevoked nếu thiếu.
- Individual dedup key dùng affected recipient + group event id.

**Luồng xử lý sau phase**

```text
group mutation transaction → membership/role + system Message + read states + outbox
commit → @conversation:group-updated + @conversation:receive
worker → affected-user notification
```

**Quy tắc nghiệp vụ và edge case**

- Add/create membership chỉ một direct notification; không phát GroupAdd và GroupJoin trùng.
- Leave actor không nhận notification/system unread sau khi đã rời.
- Kicked user nhận direct notification/group-updated nhưng không nhận system message content sau removal.
- Admin grant/revoke chỉ admin hợp lệ gọi; không để group có member nhưng không admin; sole-admin guard giữ tương thích.
- System message không kích hoạt generic MessageReply/Mention policy.
- Membership recheck ngay transaction ngăn removed member tiếp tục là recipient.

**Tương thích và dữ liệu local**

- Giữ `@conversation:group-updated` payload hiện tại, chỉ bổ sung change_type mới.
- System message đi qua `@conversation:receive` và message REST với additive fields.
- Existing transfer-admin-and-leave route giữ nguyên.

**Kiểm thử**

- Create/add/leave/kick/admin grant/revoke với A/B/C, concurrent membership changes, sole admin.
- Verify recipient matrix mục 3.8, unread và access sau remove.

**Gate hoàn thành**

- Mỗi group mutation tạo đúng một system message và direct notification đúng affected user theo matrix.
- Kicked user không fetch/receive system message sau kick.
- Admin race không tạo group orphan hoặc role duplicate.

**Rollback**

- Feature-flag system/direct handler off, giữ existing group-updated event/routes cũ. Admin routes mới có thể disable; additive messages vẫn render như fallback text.

---

## Phase 16 — Opt-in notification khi tài khoản được follow đăng tweet gốc

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Thêm notification tweet gốc theo từng follow relation bằng queued fan-out có backpressure.

**Phạm vi chức năng**

1. Follow notification preference.
2. Batched fan-out cho original public tweet.

**Phụ thuộc**

- Phase 6 outbox/queue, Phase 7 safe follower relation, Phase 8 TweetCreated event, Phase 9 unread.

**File tạo mới**

- `src/queues/notification-fanout.queue.ts`: fanout queue/job options riêng.
- `src/modules/notification/notification-fanout.worker.ts`: cursor batch/continuation/backpressure.

**File sửa**

- `src/schemas/Follower.schema.ts`: `post_notifications_enabled: boolean=false`, timestamps.
- `src/modules/user/user.route.ts`, controller, validator, service: `PATCH /:followed_user_id/follow-notification-preferences` body `{posts:boolean}`; chỉ relation owner đổi.
- `src/modules/notification/notification-event.handler.ts`, policy/repository/delivery.
- `src/modules/tweet/tweet.service.ts`: bảo đảm TweetCreated phân biệt type/audience, không tự fan-out.
- `src/constants/enums/notification.enum.ts`: FollowedUserTweet.
- `src/config/getEnvConfig.ts`: concurrency/rate config nếu cần.
- `endpoint.md`, `swagger.yaml`.

**Schema và index**

```text
followers:
post_notifications_enabled default false
{ followed_user_id: 1, post_notifications_enabled: 1, _id: 1 }
```

- Follow relation tạo mới mặc định false; relation local cũ có thể bị xóa/reset, không backfill preference.
- Individual dedup key: `recipient:FOLLOWED_USER_TWEET:TWEET:tweet_id`.

**Luồng xử lý sau phase**

```text
original public TweetCreated → root fanout job → query 500 opted-in followers → idempotent notification batch → continuation cursor
```

**Quy tắc nghiệp vụ và edge case**

- Chỉ `TweetType.Tweet` + Everyone; không reply/repost/quote/edit/restore/Circle.
- Default false; unfollow xóa preference cùng relation.
- Worker recheck relation, preference, block và recipient tồn tại trước persist.
- Retry batch/cursor không duplicate nhờ jobId/dedup key.
- Delete tweet trước worker khiến handler suppress; delete sau delivery Phase 17 invalidate.
- Queue lag không giữ HTTP request.

**Tương thích và dữ liệu local**

- Follow endpoints hiện tại không đổi; thêm endpoint preference.
- Không thay newsfeed fan-out hiện tại trong phạm vi notification.

**Kiểm thử**

- 0/1/501/10.000 opted-in followers, block/unfollow/delete giữa batch, retry continuation.
- Verify request create tweet latency không tỷ lệ follower count.

**Gate hoàn thành**

- 1.200 opt-in recipients tạo ba batch (500/500/200), mỗi recipient một item.
- Reply/quote/repost cùng author tạo zero fanout item.
- Kill/restart worker tiếp tục cursor mà không duplicate.

**Rollback**

- Pause fanout queue/handler; preference field và pending outbox giữ để replay hoặc expire theo quyết định vận hành. Tweet creation không bị ảnh hưởng.

---

## Phase 17 — Target lifecycle, block/privacy và loại bỏ direct caller

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Đảm bảo notification không tiếp tục lộ target/actor không còn hợp lệ và hoàn tất chuyển mọi production caller khỏi direct insert.

**Phạm vi chức năng**

1. Delete/revoke/block/banned actor lifecycle.
2. Reset notification legacy local và remove direct callers.

**Phụ thuộc**

- Phase 7–16 đã phát domain event và có schema/aggregation/unread.
- Phase 18 audit phụ thuộc cleanup này.

**File tạo mới**

- `src/modules/notification/notification-lifecycle.service.ts`.

**File sửa**

- `src/modules/tweet/tweet.service.ts`: TweetDeleted/mention lifecycle outbox trong delete/update transaction.
- `src/modules/conversation/conversation.service.ts`: MessageRevoked/DeleteForMe lifecycle event đúng audience.
- `src/modules/user/user.service.ts`: UserBlocked/UserUnblocked và banned/deleted hook nếu business path tồn tại.
- `src/modules/notification/notification-event.handler.ts`, repository/query/aggregation/unread/lifecycle.
- `src/modules/notification/notification.service.ts`: facade legacy không còn production caller; giữ compatibility entry point có deprecation note.
- `src/socket/chat.handler.ts`: bỏ direct generic notification import/call đã thay ở Phase 13.
- `src/constants/enums/notification.enum.ts`, `endpoint.md`, `swagger.yaml`.

**Schema và index**

- Dùng `invalidated_at`, target index và NotificationActor source/actor indexes hiện có.
- Trước khi bật lifecycle handler, reset `notifications`, `notificationActors` và `notificationStates`; chỉ document schema v2 mới được giữ.
- Không infer `target_type/context` hoặc archive notification legacy.

**Luồng xử lý sau phase**

```text
target/user lifecycle outbox → lifecycle policy → invalidate individual/remove aggregate actors → unread transition → updated/removed socket
```

**Quy tắc nghiệp vụ và edge case**

- Tweet deleted invalidates notification trỏ child/target tweet và actor edges liên quan.
- Message revoke invalidates Reply/Mention/Reaction target; delete-for-me chỉ tác động notification của actor không còn nhìn thấy target.
- Block hai chiều suppress future; job theo cursor invalidate individual cross-user và loại actor khỏi aggregate của hai phía.
- Actor banned/deleted không được hydrate; future event suppress; existing item hoặc aggregate actor được redact/remove theo policy.
- Unblock không tự khôi phục notification đã invalidated.
- Mọi invalidate unread chỉ decrement một lần và emit removed/update sau commit.

**Tương thích và dữ liệu local**

- List tiếp tục giữ field legacy cho item hợp lệ.
- Local reset có thể physical delete notification/actor cũ; lifecycle runtime vẫn dùng invalidate để giữ hành vi idempotent.
- Direct `createNotification()` calls trong User/Tweet/Chat phải bằng 0 sau grep; facade chỉ dành cho compatibility nội bộ.

**Kiểm thử**

- Delete tweet/revoke/delete-for-me/block/unblock/banned actor, aggregate nhiều actor, concurrent lifecycle/like.
- Reset local rồi bootstrap schema/index hai lần.
- Privacy test bảo đảm REST/socket không lộ actor/target đã block.

**Gate hoàn thành**

- Block A-B làm future cross events zero và item/actor edge bị xử lý đúng mà unread không âm.
- Delete target làm notification biến khỏi list; retry lifecycle không đổi count lần hai.
- `rg createNotification` không còn production caller ngoài notification module.

**Rollback**

- Pause lifecycle handlers và reset dữ liệu local nếu cần rollback; không cung cấp un-invalidate migration/audit cho dữ liệu test cũ.

---

## Phase 18 — Backend final audit và frontend contract handoff

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Khóa chất lượng backend notification sau khi hoàn thành Phase 1–17, đồng bộ source code với tài liệu và bàn giao một contract đủ rõ để frontend triển khai độc lập.

Phase này chỉ xác nhận backend ở phạm vi local/test và contract-ready cho frontend; không tuyên bố production-ready hoặc runtime-verified. Không xây thêm production tooling, migration hay cơ chế bảo toàn dữ liệu local cũ.

**Phạm vi chức năng**

1. Audit kiến trúc, dependency boundary, idempotency và security/privacy bằng source code.
2. Xác nhận không còn runtime business path bypass typed event/outbox/handler pipeline.
3. Chuẩn hóa logging tối thiểu phục vụ debug local, không thêm metrics/monitoring framework.
4. Audit source of truth giữa code, schema/index, REST, Socket.IO và tài liệu.
5. Hoàn thiện contract bàn giao frontend và giữ compatibility hiện tại.

**Phụ thuộc**

- Tất cả Phase 1–17.

**File tạo mới**

- Không bắt buộc.
- Không tạo `notification-reconciliation.service.ts`, `notification-replay.service.ts`, admin endpoint hoặc scheduled job mới chỉ để phục vụ production.
- Chỉ tách file mới nếu audit phát hiện boundary hiện tại sai hoặc coupling cần sửa để contract backend nhất quán.

**File sửa**

- `src/modules/notification/*`: audit policy/handler/repository/query/aggregation/unread/lifecycle/delivery; chỉ bổ sung structured log còn thiếu gồm event_id, event_type, handler outcome, job attempt và latency.
- `src/modules/events/*`, notification/fanout worker: audit outbox publish/claim/retry/dead-letter/idempotency và các replay primitive đã được Phase 6 cam kết; không thêm range replay hoặc metrics framework.
- `src/modules/user/*`, `src/modules/tweet/*`, `src/modules/conversation/*`, socket handlers liên quan: xóa runtime caller còn bypass pipeline hoặc direct generic notification path.
- `src/config/getEnvConfig.ts`: audit feature flag, default và flag đã chết; không để legacy/new writer chạy song song cùng intent.
- `src/config/database.service.ts`: đối chiếu final index definition với bootstrap; không auto-drop hoặc rebuild index.
- `src/schemas/Message.schema.ts`, conversation read service: xác nhận không đọc hoặc dual-write `read_by`; có thể bỏ field khỏi dữ liệu local sau reset nếu code không còn cần compatibility payload.
- `src/app.ts`: audit startup/shutdown và dependency initialization hiện có; chỉ yêu cầu Redis/worker khi feature tương ứng được bật, không bắt buộc thêm readiness framework mới.
- `eslint.config.mjs`: ignore build artifacts để backend lint phản ánh source thay vì `dist`, nếu vẫn đúng với config lúc triển khai.
- `endpoint.md`, `swagger.yaml`, `README.md`, `package.json`: đồng bộ contract và script build/audit hiện có; không thêm script production chỉ để hoàn thành phase.
- `phase-noti.md`: chỉ cập nhật trạng thái sau khi gate thật đạt.

**Schema và index**

- Không schema mới mặc định.
- Audit tĩnh schema/index cho notification feed, unread state, aggregate actor, outbox, fanout và conversation read-state; xác nhận bootstrap có đủ index đã khai báo.
- Không thêm TTL/retention/migration. `dead_letter` và dữ liệu local có thể được reset thủ công theo phạm vi phát triển hiện tại.
- Không dùng `countDocuments` làm runtime fallback cho notification unread và không dùng `Message.read_by` làm source hoặc dual-write.

**Luồng xử lý sau phase**

```text
backend source audit → sửa boundary/legacy path còn sai → đồng bộ contract/tài liệu → frontend handoff
```

**Backend architecture audit**

- Không còn runtime caller gọi trực tiếp `NotificationService.createNotification()` ngoài compatibility entry point nội bộ đã được đánh dấu deprecated và không có business caller.
- Mọi notification-producing intent đi theo pipeline:

```text
business mutation → typed domain event + transactional outbox → publisher/worker
→ handler/policy → repository + unread state trong transaction → delivery sau commit
```

- Business service chỉ phát typed domain event; handler/policy chịu trách nhiệm map recipient, NotificationType, dedupe, aggregation và suppression.
- Repository không emit socket; delivery không quyết định recipient hoặc chứa business policy; policy không persistence.
- Generic message không tạo activity notification item; message delivery và inbox unread là channel/state riêng.
- Không còn circular import/runtime dependency giữa notification với Tweet/User/Conversation; dependency ngược chỉ đi qua typed event hoặc interface đã chốt.
- Retry/dedup/replay primitive giữ original event_id/source key và luôn đi lại qua policy; không có đường bypass block, lifecycle hoặc idempotency guard.

**Notification và read-state audit**

- Notification document/item là dữ liệu bền để đối chiếu trạng thái đọc; `NotificationState` là nguồn runtime duy nhất phục vụ notification unread count và không fallback sang `countDocuments`.
- `NotificationActor` chỉ giữ source edge phục vụ aggregation; một aggregate nhiều actor vẫn tính một unread item.
- `ConversationReadState` và `UserMessageState` là nguồn runtime cho read position/unread summary; `Message.read_by` không được đọc hoặc dual-write.
- Notification/unread mutation giữ cùng transaction; emit chỉ chạy sau commit.
- Audit các reconciliation command/primitives tối thiểu đã được Phase 9/12 cam kết và replay-by-event-id primitive đã được Phase 6 cam kết; Phase 18 không mở rộng chúng thành production service, scheduler, range tool hoặc admin API.

**Source of truth audit**

Đối chiếu `phase-noti.md`, `endpoint.md`, `swagger.yaml`, `README.md`, schema/index, NotificationType, domain event variant, Socket.IO event, DTO, validator và REST response để xác nhận:

- Không có endpoint/event/type được tài liệu hóa nhưng không tồn tại trong code hoặc có trong code nhưng thiếu contract.
- Không còn NotificationType, feature flag, DTO, enum, helper hoặc compatibility path đã chết sau Phase 1–17.
- Field frontend được phép phụ thuộc và field backend-only được phân biệt rõ; ví dụ payload không buộc frontend suy luận từ internal outbox/actor/read-state fields.
- Tài liệu mô tả đúng aggregation window, pagination cursor, unread semantics, mark-one/read-all, reconnect/refresh và error contract.

**Frontend handoff**

- Chốt danh sách REST endpoint, request/response/error và pagination contract.
- Chốt Socket.IO event, room/audience, payload và thứ tự REST reconcile sau reconnect.
- Chốt NotificationType, individual/aggregate behavior, unread count, mark read, mark all và lifecycle updated/removed behavior.
- Ghi rõ field public ổn định, field additive/nullable và field chỉ dùng nội bộ backend.
- Frontend có thể triển khai từ `endpoint.md`/`swagger.yaml`/README mà không phải đọc source để suy luận hành vi.

**Tương thích và dữ liệu local**

- Giữ REST endpoint, Socket.IO event và legacy response field ở mục 10; đặc biệt `@notification:new` vẫn emit raw Notification object ở top-level.
- Không cleanup public compatibility chỉ vì backend nội bộ không còn dùng. Việc bỏ field/endpoint/event chỉ thuộc kế hoạch khác sau khi frontend triển khai và xác nhận không phụ thuộc.
- Có thể reset collection local bị ảnh hưởng; không viết migration/backfill/reconciliation để bảo toàn dữ liệu test cũ.

**Không triển khai trong phase này**

- Generalized reconciliation/rebuild service, generalized dead-letter/range replay tool, admin API hoặc scheduled repair job mới.
- Load test, benchmark/SLA, fault injection, kill/restart matrix hoặc multi-instance runtime verification.
- Metrics framework, dashboard, tracing platform, alerting hoặc production health/readiness framework mới.
- Production migration, processed-outbox retention/TTL hoặc kế hoạch bảo toàn dữ liệu cũ.
- Frontend page, badge component, client cache/socket hook hoặc cleanup public compatibility.

**Kiểm thử**

- `npx tsc --noEmit`, `npm run build`, targeted/full source lint phù hợp config hiện tại và Swagger parse.
- Static audit caller/import/dependency, feature flag, schema/index bootstrap, ownership query, REST/Socket contract và code thừa.
- Security/privacy vẫn phải được review tĩnh: recipient scope, mark ownership, block policy, lifecycle hydration và sensitive logging.
- Runtime, concurrency, load, fault injection và multi-instance test được ghi là chưa chạy/deferred; chúng không phải gate Phase 18 trong phạm vi local hiện tại.

**Gate hoàn thành**

- Typecheck/build/lint được chọn và Swagger parse pass, hoặc baseline lỗi ngoài phạm vi được ghi rõ bằng bằng chứng.
- Static audit xác nhận không còn runtime business caller bypass notification pipeline hoặc direct generic notification path.
- Boundary giữa business event, policy, repository, unread state và delivery thống nhất; không có circular runtime dependency ngoài interface/event boundary đã chốt.
- Notification/read-state source of truth, replay/reconciliation primitive kế thừa và feature flag khớp code thực tế, không tuyên bố những runtime scenario chưa được chạy.
- `endpoint.md`, `swagger.yaml`, README, enum/type/DTO và REST/Socket implementation đồng bộ; compatibility contract mục 10 vẫn được giữ.
- Frontend có đủ contract về payload, aggregation, pagination, unread/read, reconnect, lifecycle và error để triển khai mà không cần suy luận từ source.
- Chỉ cập nhật trạng thái Phase 18 sau khi các gate local/static trên đạt; production/runtime checklist deferred không chặn handoff này.

**Rollback**

- Revert các cleanup/audit change làm sai contract; bật lại feature flag tương ứng nếu một legacy internal path vẫn cần thiết.
- Reset dữ liệu local nếu thay đổi schema/index ngoài dự kiến; không yêu cầu migration, replay hay reconciliation để cứu dữ liệu test cũ.

## 6. Bảng dependency giữa các phase

| Phase                          | Phụ thuộc bắt buộc         | Phase phụ thuộc về sau |
| ------------------------------ | -------------------------- | ---------------------- |
| 1 DB/index foundation          | Baseline                   | 2–18                   |
| 2 REST correctness             | 1                          | 3–4, 9                 |
| 3 Schema v2/cursor             | 2                          | 4–10, 13–18            |
| 4 Repository/policy/delivery   | 3                          | 5–18                   |
| 5 Typed event/idempotency      | 4                          | 6–18                   |
| 6 Outbox/BullMQ                | 1, 5, transaction verified | 7–18                   |
| 7 Follow                       | 6                          | 16–17                  |
| 8 Reply/Quote/Mention          | 6–7                        | 10, 16–17              |
| 9 Notification unread          | 3–6                        | 10, 13–18              |
| 10 Like/Repost aggregation     | 6, 9                       | 14, 17–18              |
| 11 Unified Message command     | 1, 5–6                     | 12–15, 17              |
| 12 Message read state          | 11, group limit verified   | 13–15, 18              |
| 13 Message Reply/Mention       | 9, 11–12                   | 14–17                  |
| 14 Message Reaction            | 10–13                      | 17–18                  |
| 15 Group events/admin          | 11–13                      | 17–18                  |
| 16 Followed tweet fan-out      | 6–9, 7–8                   | 17–18                  |
| 17 Lifecycle/privacy/cleanup   | 7–16                       | 18                     |
| 18 Backend final audit/handoff | 1–17                       | Không có               |

Thay đổi thứ tự so với gợi ý ban đầu: NotificationState nằm trước aggregation vì aggregate read/new-actor transition không thể có gate đo được nếu unread vẫn chỉ là `countDocuments` rời rạc.

## 7. Notification event matrix cuối cùng

| Domain event                        | In-app notification              | Socket                                    | Badge                        | System message | Push tương lai    |
| ----------------------------------- | -------------------------------- | ----------------------------------------- | ---------------------------- | -------------- | ----------------- |
| UserFollowed                        | Có                               | `@notification:new`                       | Notification                 | Không          | Tùy chọn          |
| FollowedUserOriginalTweetCreated    | Có nếu opt-in                    | `@notification:new`                       | Notification                 | Không          | Tùy chọn          |
| TweetLiked                          | Có, aggregate                    | new/updated                               | Notification item            | Không          | Không mặc định    |
| TweetReposted                       | Có, aggregate                    | new/updated                               | Notification item            | Không          | Không mặc định    |
| TweetQuoted                         | Có, individual                   | new                                       | Notification                 | Không          | Tùy chọn          |
| TweetReplied                        | Có, individual                   | new                                       | Notification                 | Không          | Tùy chọn          |
| TweetMentioned                      | Có, individual                   | new                                       | Notification                 | Không          | Tùy chọn          |
| Direct/Group MessageCreated generic | Không ở activity tab             | `@conversation:receive`                   | Inbox                        | Không          | Có nếu không mute |
| MessageReplied                      | Có cho original sender           | notification + conversation               | Notification + Inbox         | Không          | Có nếu không mute |
| GroupMessageMentioned               | Có cho mentioned member          | notification + conversation               | Notification + Inbox         | Không          | Có nếu không mute |
| MessageReactionChanged              | Có, aggregate cho message sender | notification + existing reaction event    | Notification                 | Không          | Không mặc định    |
| GroupMemberAdded/Joined             | Có cho member mới                | group-updated + receive                   | Notification + Inbox         | Có             | Tùy chọn          |
| GroupMemberLeft                     | Không cho actor                  | group-updated + receive                   | Inbox của member còn lại     | Có             | Không             |
| GroupMemberKicked                   | Có cho người bị kick             | group-updated; receive chỉ member còn lại | Notification + Inbox còn lại | Có             | Tùy chọn          |
| GroupAdminGranted/Revoked           | Có cho affected user             | group-updated + receive                   | Notification + Inbox         | Có             | Tùy chọn          |
| TargetInvalidated/UserBlocked       | Update/remove item               | updated/removed/count                     | Giảm nếu đang unread         | Không          | Không             |

Không phải event nào cũng tạo Notification document. Inbox unread và system message là state/conversation channel độc lập với notification tab.

## 8. Bảng schema/index và reset dữ liệu local theo phase

| Phase | Collection/schema                         | Thay đổi                                                  | Xử lý dữ liệu local                                      |
| ----- | ----------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| 1     | Existing indexes                          | Ensure từng index, shared client                          | Không cần reset                                          |
| 3     | notifications                             | Field v2 + feed/dedup/target index                        | Reset collection nếu document cũ xung đột schema/index   |
| 6     | outboxEvents                              | Outbox schema + unique/status indexes                     | Tạo collection sạch; có thể xóa collection test cũ       |
| 9     | notificationStates                        | Unread/version                                            | Reset notifications/state/actors và bắt đầu counter từ 0 |
| 10    | notificationActors, tweets                | Actor edges; active aggregate; unique repost relation     | Xóa Retweet trùng hoặc reset tweets trước unique index   |
| 11    | messages                                  | `client_message_id`, origin/forward typed; unique partial | Reset messages nếu dữ liệu cũ cản validator/index        |
| 12    | conversationReadStates, userMessageStates | Read position/counters/summary                            | Reset messages/read-state; không dùng `read_by`          |
| 13    | messages                                  | `mention_user_ids`                                        | Reset messages nếu schema cũ không tương thích           |
| 15    | messages                                  | kind/system event fields                                  | Reset messages; document mới có kind rõ ràng             |
| 16    | followers                                 | post notification preference/index                        | Reset follower relations; relation mới mặc định false    |
| 17    | notifications/actors                      | target/lifecycle và cleanup                               | Reset toàn bộ notification local; chỉ giữ schema v2      |
| 18    | outbox/read-state                         | Retention và final cleanup                                | Reset collection bị ảnh hưởng nếu contract không khớp    |

## 9. Quy tắc aggregation/dedup tóm tắt

| Intent                    | Aggregation key                      | Dedupe/source                             | Undo                                                      |
| ------------------------- | ------------------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| Follow                    | Không aggregate                      | recipient + follower relation id          | Unfollow không tạo event; pending worker recheck relation |
| Reply/Quote/Mention tweet | Không aggregate                      | recipient + type + child tweet id         | Edit mention invalidate removed; delete target Phase 17   |
| Like tweet                | recipient + LIKE + tweet id          | NotificationActor source Like id          | Unlike remove edge                                        |
| Repost tweet              | recipient + REPOST + parent tweet id | NotificationActor source retweet tweet id | Undo remove edge                                          |
| Followed tweet            | Không aggregate                      | recipient + tweet id                      | Delete target invalidate                                  |
| Message Reply/Mention     | Không aggregate                      | recipient + type + message id             | Revoke/delete-for-recipient invalidate                    |
| Message Reaction          | recipient + REACTION + message id    | actor + message source edge               | Remove reaction edge; emoji change no count change        |
| Group affected-user event | Không aggregate                      | recipient + event type + outbox event id  | Lifecycle event riêng nếu mutation rollback/compensate    |

## 10. Contract REST và Socket.IO phải giữ tương thích

### 10.1. REST giữ nguyên

```text
GET  /api/notifications
POST /api/notifications/read-all
POST /api/notifications/:id/read

GET  /api/conversations
POST /api/conversations/:conversation_id/read
```

Các field legacy giữ:

```text
Notification: _id, recipient_id, sender_id, type, target_id, is_read, created_at
GET notifications: notifications, unreadCount, next_cursor, has_next_page
Message: existing content/media/sender/reply/status/reactions fields
```

REST additive dự kiến:

```text
GET   /api/notifications/unread-count
GET   /api/conversations/unread-summary
PATCH /api/user/:followed_user_id/follow-notification-preferences
POST  /api/conversations/:conversation_id/admins/:user_id
DELETE /api/conversations/:conversation_id/admins/:user_id
```

### 10.2. Socket giữ nguyên

```text
@notification:new
@conversation:send
@conversation:receive
@conversation:error
@message:reaction-updated
@message:revoked
@conversation:group-updated
@user:block-status-changed
```

Event additive:

```text
@notification:updated
@notification:removed
@notification:unread-count
@notification:read-state
@conversation:read
@conversation:read-state
```

`@notification:new` tiếp tục emit Notification object với field legacy ở top-level; không đổi sang wrapper `{notification, unread_count}`. Count/version phát event riêng.

## 11. Những mục chủ động không làm

- Frontend page, badge component, React Query hoặc socket hook.
- Web push/mobile push, device token và permission UI.
- Public group invitation/accept/self-join workflow.
- Notification cho bookmark, view, unlike, undo hoặc unbookmark; undo chỉ reconcile aggregate hiện có.
- Fan-out notification cho mọi follower mặc định hoặc cho Twitter Circle khi chưa có audience membership model.
- Physical delete/TTL notification, outbox dead-letter hoặc audit actor data.
- Exactly-once Socket.IO delivery; hệ thống dùng at-least-once + idempotent client/server state.
- Đổi tên hàng loạt legacy field/endpoint/event.
- Refactor newsfeed fan-out hoặc module không liên quan.
- Cài Jest/Vitest hoặc test framework mới trong kế hoạch này.

## 12. Release milestone và rollback độc lập

1. **Release A — Foundation:** Phase 1–4. Rollback code không cần rollback data vì chỉ additive/index.
2. **Release B — Reliable event core:** Phase 5–6. Outbox feature flag mặc định off; rollback bằng pause publisher/worker.
3. **Release C — Social individual:** Phase 7–8. Mỗi event family có handler flag; không chạy legacy/new song song.
4. **Release D — Notification state/aggregation:** Phase 9–10. Rollback bằng pause handler/feature flag và reset notification state/actor local nếu cần.
5. **Release E — Message foundation:** Phase 11–12. Chuyển thẳng command/read path sau khi reset messages/read-state; không dual-write `read_by`.
6. **Release F — Directed message/group:** Phase 13–15. Từng handler/system message có flag; existing conversation socket contract giữ nguyên.
7. **Release G — Tweet fan-out:** Phase 16. Queue độc lập có thể pause mà không ảnh hưởng tweet creation.
8. **Release H — Lifecycle/backend handoff:** Phase 17–18. Reset notification local trước khi bật lifecycle v2; Phase 18 audit code/contract và bàn giao frontend, rollback bằng feature flag hoặc reset lại dữ liệu test khi cần.

Mỗi milestone phải nằm trong commit/nhóm commit riêng và ghi rõ feature flag/default, collection local cần reset, lệnh bootstrap/index, rollback code và compatibility snapshot.

## 13. Checklist nghiệm thu toàn hệ thống

Checklist dưới đây giữ lại các scenario mong muốn của toàn hệ thống để dùng khi integration/runtime hoặc chuẩn bị production về sau. Trong phạm vi local hiện tại, Phase 18 chỉ bị chặn bởi **Backend handoff gate** ở cuối mục này và gate riêng của Phase 18; các mục load/fault/multi-instance/benchmark chưa chạy phải được ghi là deferred, không được mô tả là đã pass.

### Foundation và contract

- [ ] Một MongoClient/pool dùng chung; socket count không làm pool count tăng tuyến tính.
- [ ] Startup bảo đảm toàn bộ index và fail-fast khi index không thể tạo.
- [ ] Notification pagination limit+1, cursor tuple, concurrent insert không duplicate/missing theo contract.
- [ ] REST legacy fields/path và `@notification:new` giữ nguyên.

### Reliability/idempotency

- [ ] Cùng event_id xử lý ít nhất ba lần chỉ tạo một state transition.
- [ ] Kill/restart publisher/worker ở mọi cửa sổ enqueue/persist/emit không làm mất persisted notification.
- [ ] Dead-letter có last_error, attempts và replay idempotent.
- [ ] Socket emit lặp không tạo duplicate DB/count; reconnect reconcile đúng.

### Social

- [ ] Follow self/existing/blocked không tạo relation/event/notification sai.
- [ ] Reply/Quote/Mention precedence đúng; mixed mention chỉ một recipient intent.
- [ ] Like/Repost concurrent aggregate/count/preview/unread đúng.
- [ ] Unlike/Undo idempotent; count 0 invalidates.
- [ ] Tweet delete/edit mention/block lifecycle không để item trái privacy.
- [ ] Followed-user tweet chỉ original public + opt-in; batch/retry/backpressure đúng.

### Notification unread

- [ ] Notification badge bằng số item unread, aggregate nhiều actor tính một.
- [ ] Mark one/all không âm và không nuốt item đến sau cutoff.
- [ ] Multi-tab/device nhận count/version có thẩm quyền.
- [ ] Reconciliation NotificationState báo zero drift.

### Messaging

- [ ] Send/forward qua một command service; không production writer khác.
- [ ] Same client_message_id không tạo message/broadcast/unread/event trùng.
- [ ] Per-conversation unread, total unread và unread-conversation count khớp.
- [ ] Read tới message N không mark message N+1; active conversation ack đúng.
- [ ] Generic message không tạo activity item sau khi chuyển sang command path; Reply/Mention precedence đúng.
- [ ] Reaction change/remove/concurrent aggregation đúng.
- [ ] Removed member không nhận message/unread/system message sau mutation.

### Group

- [ ] Add/join/leave/kick/admin grant/revoke đúng matrix người nhận.
- [ ] Một mutation tạo đúng một system message, không trigger generic notification.
- [ ] Sole-admin và concurrent role mutation không tạo group mồ côi.

### Security/privacy/performance

- [ ] Recipient không đọc/mark notification của người khác.
- [ ] Block hai chiều suppress future và cleanup existing theo policy.
- [ ] Actor/target deleted/banned không lộ dữ liệu nhạy cảm.
- [ ] Query explain dùng index notification/unread/actor/outbox/read-state.
- [ ] Group max supported và fan-out 10.000 opt-in recipients đạt benchmark/SLA được ghi nhận.

### Backend handoff gate (Phase 18 local)

- [ ] `npx tsc --noEmit`, `npm run build`, targeted/full source lint và Swagger parse pass hoặc baseline lỗi ngoài phạm vi được chứng minh.
- [ ] Mọi thay đổi schema/index ghi rõ collection local cần reset; bootstrap/index chạy lại an toàn trên database sạch.
- [ ] Feature flag không cho legacy/new writer chạy song song.
- [ ] Static audit xác nhận không còn runtime business caller bypass pipeline; ownership/privacy scope và dependency boundary khớp thiết kế.
- [ ] `endpoint.md`, `swagger.yaml`, README và frontend handoff contract khớp code thật.
- [ ] Runtime/load/fault/multi-instance/benchmark chưa chạy được ghi rõ là deferred, không bị suy diễn thành production-ready.
- [ ] Chỉ sau backend handoff gate và gate riêng của Phase 18 mới được đánh dấu Phase 18 hoàn thành; checklist runtime deferred không chặn trạng thái local/contract-ready.
