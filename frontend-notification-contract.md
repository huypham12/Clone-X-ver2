# Frontend notification contract — Phase 18 handoff

Backend hiện hỗ trợ notification feed ổn định theo `created_at + _id`, cursor opaque, schema v2 additive và public hydration cho actor/target. Ba REST path và event `@notification:new` legacy vẫn giữ nguyên.

Backend hỗ trợ đường durable cho Follow, Reply, Quote, Mention, Like, Repost, directed Message Reply/Group Mention, tweet gốc opt-in và lifecycle target/block; unread state có version cùng các event cập nhật/xóa item. Generic `message` và `message_reaction` là type storage compatibility đã bị loại khỏi generation, durable feed và unread policy. API business trả về sau khi transaction commit và notification có thể xuất hiện hoặc bị loại bất đồng bộ qua socket hoặc lần REST refetch tiếp theo.

Các REST contract liên quan vẫn giữ response cũ:

- `POST /api/user/:followed_user_id/follow`: `200` với `data: null`; self-follow/ID sai trả `400`, block hai chiều `403`, user không tồn tại `404`, relation trùng `409`.
- `DELETE /api/user/:followed_user_id/follow`: `200` với `data: null`; relation không tồn tại trả `400`.
- `POST /api/tweets` và `PATCH /api/tweets/:tweet_id`: request/response giữ nguyên. Mảng `mentions` là tối đa 20 ObjectId string; backend dedupe với username `@...` trong content rồi chỉ giữ following, follower hoặc user thuộc ngữ cảnh tweet liên quan, đồng thời loại self, block hai chiều, user banned/không tồn tại. Với PATCH, bỏ qua `mentions` sẽ giữ nguyên danh sách đã lưu dù `content` thay đổi; muốn thêm hoặc bỏ mention, frontend phải gửi toàn bộ danh sách explicit mention mong muốn.

## REST

Tất cả endpoint yêu cầu `Authorization: Bearer <access_token>`.

### `GET /api/user/mention-candidates`

Query:

- `q`: chuỗi `0..15` ký tự, mặc định rỗng; chỉ lọc trong tập candidate hợp lệ, không search toàn bộ user.
- `tweet_id`: optional ObjectId. Khi có, backend cộng thêm author, liker và actor của reply/repost/quote trực tiếp của tweet nếu caller được xem context đó.
- `limit`: số nguyên `1..20`, mặc định `8`.

Response `data` là mảng `{ _id, name, username, avatar?, source }`, trong đó `source` là `following`, `follower` hoặc `interaction`. Kết quả ưu tiên following -> follower -> interaction, dedupe theo user ID và loại caller, block hai chiều, user banned, bị xóa hoặc thiếu username. Endpoint query theo relation/context có giới hạn; không lấy danh sách user toàn hệ thống rồi filter ở frontend.

### `GET /api/notifications`

Query:

- `limit`: số nguyên `1..100`, mặc định `10`.
- `cursor`: optional. Frontend phải gửi nguyên chuỗi `next_cursor`; không parse hoặc tự tạo cursor. Backend vẫn nhận ObjectId 24-hex do client cũ lưu lại nếu ID đó thuộc caller.

Feed chỉ chứa notification chưa bị invalidated và sort theo `{ created_at: -1, _id: -1 }`. Backend lấy `limit + 1`, vì vậy `has_next_page` phản ánh đúng việc còn trang sau.

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Get notifications successfully",
  "data": {
    "notifications": [
      {
        "_id": "<notification_id>",
        "recipient_id": "<user_id>",
        "sender_id": "<user_id_or_null>",
        "type": "like",
        "target_id": "<tweet_id_or_null>",
        "is_read": false,
        "created_at": "<ISO date>",

        "target_type": "TWEET",
        "actor_ids_preview": ["<user_id>"],
        "actor_count": 1,
        "context": {},
        "aggregation_active": false,
        "read_at": null,
        "updated_at": "<ISO date>",
        "invalidated_at": null,

        "actor_info": {
          "_id": "<user_id>",
          "name": "Actor name",
          "username": "actor_username",
          "avatar": "<url>"
        },
        "actor_infos_preview": [
          {
            "_id": "<user_id>",
            "name": "Actor name",
            "username": "actor_username",
            "avatar": "<url>"
          }
        ],
        "target_info": {
          "_id": "<tweet_id>",
          "target_type": "TWEET",
          "owner_id": "<user_id>",
          "tweet_type": 0,
          "content": "Tweet preview, tối đa 140 ký tự"
        }
      }
    ],
    "unreadCount": 1,
    "next_cursor": "<opaque_cursor_or_null>",
    "has_next_page": true
  }
}
```

Các field `deduplication_key` và `aggregation_key` chỉ xuất hiện khi document có giá trị.

Document legacy được normalize như sau:

- `actor_ids_preview` lấy từ `sender_id`, tối đa 3 actor;
- `actor_count` là `1` khi có `sender_id`, ngược lại là `0`;
- `updated_at` fallback về `created_at`;
- `context` fallback `{}`; `aggregation_active` fallback `false`;
- `read_at`, `invalidated_at`, actor/target không tìm thấy trả `null`.

Error:

- `400`: cursor sai định dạng, cursor ObjectId cũ không tồn tại/không thuộc caller, hoặc `limit` không hợp lệ.
- `401`: thiếu hoặc sai access token.

### `GET /api/notifications/:id`

Trả đúng một notification thuộc caller với cùng normalization, hydration, eligibility và redaction policy như `GET /api/notifications`. Endpoint này dùng để hydrate deterministic payload raw từ `@notification:new`/`@notification:updated` mà không scan hoặc refetch page đầu.

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Get notification successfully",
  "data": {
    "_id": "<notification_id>",
    "recipient_id": "<user_id>",
    "sender_id": "<user_id_or_null>",
    "type": "like",
    "target_id": "<tweet_id_or_null>",
    "is_read": false,
    "created_at": "<ISO date>",
    "target_type": "TWEET",
    "actor_ids_preview": ["<user_id>"],
    "actor_count": 1,
    "context": {},
    "aggregation_active": false,
    "read_at": null,
    "updated_at": "<ISO date>",
    "invalidated_at": null,
    "actor_info": {
      "_id": "<user_id>",
      "name": "Actor name",
      "username": "actor_username"
    },
    "actor_infos_preview": [],
    "target_info": null
  }
}
```

ID sai định dạng trả `400`. Item không tồn tại, không thuộc caller, đã invalidated hoặc không còn eligible trả `404`. Endpoint không trả raw identity đã bị redaction và không thay đổi unread state.

### `POST /api/notifications/:id/read`

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Marked as read successfully",
  "data": { "success": true, "unreadCount": 3, "version": 12 }
}
```

Lần chuyển từ unread sang read set `is_read=true`, `read_at`, `updated_at` và đóng aggregate window nếu có. Gọi lặp lại không đổi thời điểm đọc và vẫn trả success. ID sai định dạng trả `400`; ID không tồn tại hoặc thuộc user khác trả `404`.

### `POST /api/notifications/read-all`

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Marked all as read successfully",
  "data": { "updatedCount": 4, "unreadCount": 0, "version": 13 }
}
```

Chỉ notification chưa đọc và chưa invalidated được chuyển trạng thái. Gọi lại khi không còn item unread trả `updatedCount: 0`.

Read-all chỉ áp dụng tới cutoff được chụp lúc bắt đầu request. Với dữ liệu compatibility chưa có unread-generation marker, backend dùng tuple `{created_at, _id}`; item mới/reactivated dùng marker nội bộ nên reactivation sau cutoff vẫn unread dù giữ `_id` cũ. `unreadCount` chỉ giảm theo số document thực sự chuyển trạng thái.

### `GET /api/notifications/unread-count`

Response `200`:

```json
{
  "statusCode": 200,
  "message": "Get notification unread count successfully",
  "data": {
    "unreadCount": 3,
    "version": 12,
    "updated_at": "<ISO date>"
  }
}
```

Endpoint luôn đọc `NotificationState`, nguồn runtime duy nhất của notification badge. User chưa có state trả `unreadCount: 0`, `version: 0`, `updated_at` Unix epoch. Backend không fallback sang `countDocuments`; startup yêu cầu reset đồng thời notification/state/actor local nếu baseline cũ không tương thích.

## Dữ liệu actor, target và điều hướng

Frontend nên ưu tiên `actor_info`, `actor_infos_preview`, `target_type`, `target_info`, `context`; các ID legacy vẫn là fallback.

| `type` | `target_type` hiện tại | Điều hướng đề xuất |
| --- | --- | --- |
| `follow` | `USER` | Mở profile `actor_info._id`; `target_id` có thể là `null` với caller legacy. |
| `like`, `reply`, `retweet`, `quote`, `mention`, `followed_user_tweet` | `TWEET` | Mở tweet bằng `target_info._id`, fallback `target_id`. |
| `group_add`, `group_join`, `group_kick`, `admin_granted`, `admin_revoked` | `CONVERSATION` | Mở conversation bằng `target_info._id`, fallback `target_id`. Với user đã bị kick, `target_info` chủ động là `null`; không cố fetch nội dung group. |
| `message_reply`, `message_mention` | `MESSAGE` | Mở conversation có thẩm quyền rồi focus message target. |
| `system` | `null` nếu caller không cung cấp target | Chỉ điều hướng khi `target_type/target_info` thực sự có dữ liệu. |

`target_info` là một trong các projection công khai sau:

- `USER`: `_id`, `target_type`, `name`, `username`, optional `avatar`.
- `TWEET`: `_id`, `target_type`, `owner_id`, `tweet_type`, `content` tối đa 140 ký tự. Backend chỉ hydrate preview cho tweet audience công khai; target khác trả `null` cho tới khi có policy membership an toàn.
- `MESSAGE`: `_id`, `target_type`, `conversation_id`, `sender_id`, `content` tối đa 140 ký tự, `status`; content rỗng nếu message không còn ở trạng thái `sent`.
- `CONVERSATION`: `_id`, `target_type`, `conversation_type`; group có thể thêm `name`, `avatar_url`.

Nếu actor hoặc target đã thiếu, backend trả `actor_info: null`/`target_info: null`; frontend không được crash hoặc suy ra dữ liệu nhạy cảm. Không có email, password, token hoặc user document đầy đủ trong hydration.

## Socket.IO

### `@notification:new`

Event được emit vào personal room của `recipient_id` sau khi notification đã persist thành công. Payload vẫn là notification object trực tiếp, không có wrapper `{ notification }`; unread count được gửi bằng event riêng. Object có các field compatibility ở top-level cùng field schema v2:

```json
{
  "_id": "<notification_id>",
  "recipient_id": "<user_id>",
  "sender_id": "<user_id_or_null>",
  "type": "follow",
  "target_id": "<target_id_or_null>",
  "is_read": false,
  "created_at": "<ISO date>",
  "target_type": "USER",
  "actor_ids_preview": ["<user_id>"],
  "actor_count": 1,
  "context": {},
  "aggregation_active": false,
  "read_at": null,
  "updated_at": "<ISO date>",
  "invalidated_at": null
}
```

Socket payload không hydrate `actor_info`, `actor_infos_preview` hoặc `target_info`. Frontend hydrate chính xác item bằng `GET /api/notifications/:id`, sau đó upsert theo `_id`; nếu hydration lỗi thì REST page/focus/reconnect reconciliation vẫn là fallback bền vững. Nếu emit lỗi, notification vẫn tồn tại và sẽ xuất hiện khi gọi REST.

Phase 7–8 dùng các notification sau:

- `follow`: `target_type=USER`; item v2 dùng `target_id` là follower/actor để mở profile. Dữ liệu compatibility cũ có thể vẫn trả `target_id=null`.
- `reply`: `target_type=TWEET`, `target_id` là child reply; `context.parent_tweet_id` dùng để mở thread. Nếu parent owner cũng được mention, chỉ có Reply và `context.mentioned=true`.
- `quote`: giống Reply nhưng `type=quote` và điều hướng tới child quote.
- `mention`: `target_type=TWEET`, `target_id` là tweet chứa mention; `context.parent_tweet_id` có thể tồn tại với reply/quote.

Một `@notification:new` có `_id` đã tồn tại có thể là notification vừa được re-activate hoặc cập nhật `context`, không nhất thiết là item hoàn toàn mới. Backend theo dõi thời điểm item trở lại unread bằng field nội bộ không gửi qua REST/Socket để read-all không đọc nhầm reactivation sau cutoff. Frontend luôn upsert theo `_id` và không cộng badge lần hai nếu ID đó đã có trong cache.

Nếu backend retry đúng cùng một typed event, notification đã tồn tại được dùng lại và `@notification:new` không emit lần hai. Hai business action thực sự khác nhau vẫn có event/source key khác nhau; frontend phải dedupe socket theo `_id` và không tự suy diễn idempotency cho request nghiệp vụ không có client idempotency key.

### `@notification:unread-count`

Emit sau commit khi một individual item unread được tạo/thay thế hoặc bị invalidated. Aggregate rỗng chỉ truyền count/version trong `@notification:removed`, không phát thêm event count trùng. Payload:

```json
{ "unread_count": 3, "version": 12, "updated_at": "<ISO date>" }
```

Frontend cập nhật badge khi `version` lớn hơn version đang giữ. State khởi tạo có thể có `version: 0`; khi reconnect/focus vẫn refetch REST để đối soát event Socket.IO bị bỏ lỡ.

### `@notification:read-state`

Emit tới mọi socket trong personal room sau mark-one/read-all, kể cả request idempotent có `updated_count: 0`:

```json
{
  "action": "mark_one",
  "notification_id": "<notification_id_or_null_for_read_all>",
  "read_at": "<ISO date>",
  "updated_count": 1,
  "unread_count": 2,
  "version": 13
}
```

Với `mark_one`, set item tương ứng thành read khi `updated_count=1`. Với `read_all`, đánh dấu các item đang cache có tuple không mới hơn cutoff request; do payload không mang cutoff, cách an toàn là refetch trang đầu nếu có activity đồng thời. Badge dùng cặp `unread_count/version`.

### `@notification:updated`

Emit raw notification object khi aggregate Like/Repost đang active thay đổi actor. Frontend upsert theo `_id`, thay `sender_id`, `actor_ids_preview`, `actor_count`, `updated_at`; không tạo row mới và không tăng unread badge.

### `@notification:removed`

Emit khi actor cuối cùng undo làm aggregate bị invalidated:

```json
{
  "notification_id": "<notification_id>",
  "aggregation_key": "<recipient:TYPE:tweet>",
  "unread_count": 2,
  "version": 14,
  "updated_at": "<ISO date>"
}
```

Frontend remove item theo `notification_id`; nếu count/version có mặt thì cập nhật badge theo version, nếu thiếu thì giữ badge hiện tại và refetch unread count.

## Like/Repost aggregation và điều hướng

Khi `NOTIFICATION_SOCIAL_AGGREGATION_ENABLED=true`, Like/Repost trên cùng tweet được gom theo recipient, type và tweet trong một active window. `target_type=TWEET`, `target_id` là tweet gốc; `sender_id` là actor gần nhất; `actor_count` là số actor hiện hành; `actor_ids_preview` tối đa 3. Undo chỉ gỡ đúng relation nguồn và event lặp không giảm lần hai.

Đọc một aggregate đóng window. Activity hợp lệ tiếp theo tạo một notification mới bằng `@notification:new`; frontend không được merge hai `_id` chỉ vì cùng `aggregation_key`. Khi aggregate còn actor, undo phát `@notification:updated`; khi về 0 phát `@notification:removed` và item không còn trong REST feed.

## Cache, reconnect và nhiều tab

- Khi nhận `@notification:new`, insert/upsert theo `_id`; không cộng badge nhiều lần cho event trùng.
- Nhiều tab/device đều có thể nhận cùng `_id`; mỗi tab tự dedupe.
- Khi reconnect, tab regain focus hoặc phát hiện cursor/cache lệch, refetch trang đầu. REST là nguồn đối soát vì Socket.IO không replay event offline.
- Khi paginate, merge theo `_id` và giữ order `created_at DESC, _id DESC`. Activity mới không làm thay đổi cursor trang đang tải.
- Áp dụng state socket theo `version`; bỏ qua count có version nhỏ hơn state đang giữ. Vẫn upsert/remove item theo `_id` vì item event và count event là hai message riêng.
- Mark-one/read-all phát `@notification:read-state` tới mọi tab/device trong personal room. Khi payload không đủ để xác định chính xác cache page, refetch trang đầu và `/unread-count`.
- Không tự remove item chỉ vì `target_info=null`; đây có thể là target unavailable. Item invalidated sẽ biến mất ở lần REST refetch.
- Khi PATCH có field `mentions` và một mention bị bỏ khỏi danh sách đã resolve, backend invalidate Mention item, phát `@notification:removed` sau commit và REST không còn trả item đó. PATCH chỉ đổi `content` nhưng bỏ qua `mentions` không thay đổi mention state.

## Unread, feature control và giới hạn hiện tại

- `data.unreadCount` là số notification item eligible chưa đọc và chưa invalidated; một aggregate nhiều actor vẫn chỉ tính là một item. List và endpoint unread-count đọc `NotificationState`; reconciliation thông thường chỉ đếm type còn eligible. Backend không lưu policy migration marker.
- Inbox unread count, tổng unread message và unread từng conversation đã được bổ sung ở Phase 12; xem phần contract unread của conversation bên dưới.
- Backend dùng `@notification:new` cho item/window mới, individual reactivation sau invalidation hoặc context update. Reactivation có thể giữ `_id` cũ nhưng là một unread generation mới; `@notification:updated` thay thế aggregate còn actor; `@notification:removed` loại aggregate rỗng hoặc individual item bị invalidated bởi mention edit, target delete, revoke, delete-for-me hay block.
- Mọi runtime business notification đi qua typed event/outbox và deduplication key. Compatibility facade vẫn tồn tại nội bộ nhưng không có business caller; frontend vẫn phải upsert/dedupe theo `_id` vì Socket.IO là at-least-once/best-effort state delivery.
- Durable Follow cần đồng thời `NOTIFICATION_OUTBOX_ENABLED=true` và `NOTIFICATION_FOLLOW_OUTBOX_ENABLED=true`; durable Reply/Quote/Mention cần global flag cùng `NOTIFICATION_TWEET_OUTBOX_ENABLED=true`. Các flag mặc định bật local và chỉ là control backend; frontend không gửi hoặc lưu chúng.
- Mention removal reconcile notification được tạo bằng semantic key của Phase 8. Notification legacy không có schema/key không được infer; môi trường phải reset ba collection notification trước khi bật lifecycle v2.
- Like/Repost aggregation cần đồng thời `NOTIFICATION_OUTBOX_ENABLED=true` và `NOTIFICATION_SOCIAL_AGGREGATION_ENABLED=true`, đều mặc định bật local. Nếu Retweet relation local cũ cản unique index, reset collection `tweets`; backend không migrate/reconcile dữ liệu cũ. Runtime caller legacy đã bị loại; khi flag tương ứng tắt backend không fallback sang direct insert.
- Directed Message Reply/Group Mention cần global flag cùng `NOTIFICATION_MESSAGE_DIRECTED_ENABLED=true`. Message reaction không tạo Notification item và không có notification feature flag; reaction state trong Chat vẫn dùng REST cùng `@message:reaction-updated`.
- Group system/direct notification cần global flag cùng `NOTIFICATION_GROUP_MANAGEMENT_ENABLED=true`. Tweet gốc opt-in cần TweetCreated outbox và `NOTIFICATION_FOLLOWED_TWEET_ENABLED=true`. Các flag mặc định bật local; frontend không gửi hoặc suy diễn chúng.
- Tắt `NOTIFICATION_OUTBOX_ENABLED` là pause publisher/worker, không xóa pending outbox. `MessageCreated` vẫn được lưu cùng message để giữ transaction; khi bật lại global flag, event cũ được xử lý theo directed handler flag tại thời điểm drain. Pending `MessageReactionChanged`/`MessageReactionRemoved` cũ luôn bị notification handler suppress.
- Chưa có push notification. Preference hiện chỉ hỗ trợ tweet gốc public theo từng follow relation.
- Mọi policy durable recheck actor/recipient còn tồn tại, không banned và không bị block hai chiều. Actor/target bị block, banned, deleted, revoked hoặc delete-for-me không được hydrate; lifecycle worker invalidates item hoặc gỡ actor edge tương ứng.

## Messaging contract đã triển khai (Phase 11–16)

### Khả năng mới và idempotency

- `@conversation:send` nhận thêm `client_message_id?: string` dài 1–256 ký tự. Frontend nên tạo một ID ổn định cho mỗi thao tác gửi và giữ nguyên ID cùng toàn bộ payload khi retry. Cùng `sender_id + client_message_id` và cùng content/media/reply/mention trả lại `message_id` đã commit; dùng lại key với payload khác trả conflict. Retry hợp lệ không emit `@conversation:receive`, không tạo outbox và không tăng unread lần hai.
- Client cũ không gửi `client_message_id` vẫn hoạt động, nhưng backend không thể chống duplicate do retry cho trường hợp này.
- Forward REST nhận thêm `client_operation_id?: string` dài 1–128 ký tự. Backend canonicalize ObjectId rồi dẫn xuất idempotency key riêng cho từng conversation đích. `conversation_ids` lặp, kể cả khác hoa/thường, được dedupe; toàn bộ target được validate/commit nguyên tử.
- Message mới có thể trả additive fields `client_message_id`, `origin_message_id`, `is_forwarded`, `mention_user_ids`. `read_by` là field legacy có thể xuất hiện trên dữ liệu cũ nhưng không còn là nguồn read/unread và message mới không dual-write field này.

### REST inbox/read state

`GET /api/conversations` giữ array/field cũ và thêm vào từng item:

```json
{
  "last_message_preview": {
    "message_id": "66def...",
    "sender_id": "66aaa...",
    "sender_info": {
      "_id": "66aaa...",
      "name": "Huy",
      "username": "huy",
      "avatar": "https://..."
    },
    "kind": "user",
    "system_event_type": null,
    "content": "hahaa",
    "message_type": "text"
  },
  "unread_message_count": 4,
  "last_read_message_id": "66abc...",
  "last_read_at": "2026-07-30T10:00:00.000Z"
}
```

State chưa tồn tại trả count `0` và read fields `null`.

`last_message_preview` được hydrate theo batch từ `message_id`, không fetch từng conversation.
Message legacy thiếu `kind` được trả thành `kind=user`. System message trả `kind=system`,
`system_event_type` tương ứng và `sender_info=null`; user message trả public `sender_info` hoặc
`null` nếu sender đã bị xóa, banned hoặc có block edge với viewer. Preview không có authoritative
`message_id` trả cả `kind`, `system_event_type` và `sender_info` là `null`. Frontend chỉ thêm prefix
tên khi `kind=user` và projection có mặt; projection null dùng fallback trung tính, không dựng tên từ ID.

`GET /api/conversations/unread-summary`:

```json
{
  "statusCode": 200,
  "message": "Get conversation unread summary successfully",
  "data": {
    "unread_conversation_count": 3,
    "total_unread_message_count": 100,
    "version": 42,
    "updated_at": "2026-07-30T10:00:00.000Z"
  }
}
```

Badge icon inbox phải dùng `unread_conversation_count`. `total_unread_message_count` chỉ dùng khi UI muốn hiển thị tổng message chưa đọc.

`POST /api/conversations/:conversation_id/read` nhận body rỗng hoặc:

```json
{ "message_id": "66abc..." }
```

Body rỗng mark tới message visible mới nhất. `message_id` phải visible và thuộc conversation; sai trả `400`, không còn membership trả `403`. Response `data` gồm `success`, `conversation_id`, `last_read_message_id`, `last_read_at`, `unread_message_count`, `unread_conversation_count`, `total_unread_message_count`, `version`. Read position chỉ tiến về phía trước; message commit sau target vẫn unread.

Sau khi exact read position được commit, backend invalidate trong cùng transaction mọi `message_reply`/`message_mention` của chính user, cùng `context.conversation_id`, có message `target_id` nhỏ hơn hoặc bằng `last_read_message_id`. Item đã invalidated không còn xuất hiện trong REST feed; item đang unread đồng thời làm giảm `NotificationState` đúng một lần. Sau commit, backend phát `@notification:removed` cho từng item và phát notification unread state/version có thẩm quyền khi count thay đổi. Frontend chỉ reconcile theo ID/version, không tự ẩn item vì route conversation đã mở hoặc message mới chỉ nằm trong cache.

Message notification worker phối hợp transaction với `ConversationReadState`: nếu outbox `MessageCreated` được xử lý sau khi recipient đã đọc qua target message thì `message_reply`/`message_mention` bị suppress. Nếu notification creation và read acknowledgement chạy đồng thời, transaction conflict được retry trên committed read position; vì vậy không có cửa sổ tạo lại directed notification đã đọc. Read lặp hoặc read position cũ là idempotent và không giảm notification unread count/version lần hai.

Forward giữ endpoint `POST /api/conversations/messages/:message_id/forward` và response legacy `{ data: { success: true } }`; request mới:

```json
{
  "conversation_ids": ["66def...", "66fed..."],
  "client_operation_id": "forward:device-id:local-sequence"
}
```

### Socket.IO

`@conversation:send` request mới:

```json
{
  "conversation_id": "66def...",
  "conversation_type": "group",
  "content": "hello",
  "media_ids": [],
  "reply_to_message_id": "66aaa...",
  "mention_user_ids": ["66bbb..."],
  "client_message_id": "device-id:local-sequence"
}
```

Ack legacy giữ `{ "success": true, "message_id": "..." }`. Nếu cùng `client_message_id` bị dùng lại với payload khác, ack lỗi trả `error.code=CLIENT_MESSAGE_ID_CONFLICT`; frontend không phân loại conflict bằng nội dung `error.message`. `@conversation:receive` giữ raw hydrated message top-level và chỉ emit sau commit.

Client có thể ack read qua `@conversation:read` với `{ conversation_id, message_id? }`. Ack thành công:

```json
{
  "success": true,
  "conversation_id": "66def...",
  "unread_message_count": 0,
  "unread_conversation_count": 2,
  "total_unread_message_count": 96,
  "version": 43
}
```

`@conversation:read-state` được emit sau commit unread/read-state:

```json
{
  "conversation_id": "66def...",
  "last_read_message_id": "66abc...",
  "last_read_at": "2026-07-30T10:00:00.000Z",
  "unread_message_count": 0,
  "unread_conversation_count": 2,
  "total_unread_message_count": 96,
  "version": 43,
  "updated_at": "2026-07-30T10:00:00.000Z"
}
```

### Cache, reconnect và nhiều tab

- Upsert message theo `_id`. Nếu vừa optimistic-insert vừa nhận `@conversation:receive`, không append lần hai.
- Với `@conversation:read-state`, chỉ áp dụng payload có `version` lớn hơn hoặc bằng version summary đang cache; cập nhật conversation theo `conversation_id` và summary trong cùng cache transaction.
- Nhiều tab/device cùng join personal room nên có thể nhận event giống nhau. Event là state có thẩm quyền, không phải delta; không tự cộng/trừ thêm khi nhận trùng.
- Khi user rời hoặc bị xóa khỏi group, backend xóa read-state của group, giảm inbox summary trong cùng transaction và emit state có `unread_message_count: 0` tới personal room của user đó.
- Sau reconnect, refetch `GET /api/conversations/unread-summary` và `GET /api/conversations`; Socket.IO không replay event offline.
- Nếu ack send timeout, retry đúng `client_message_id` rồi upsert theo `message_id`. Không tạo ID mới cho cùng thao tác.

### Directed message notification (Phase 13)

Khi `NOTIFICATION_OUTBOX_ENABLED=true` và `NOTIFICATION_MESSAGE_DIRECTED_ENABLED=true`:

- Reply hợp lệ tạo notification `type=message_reply`; group mention tạo `type=message_mention`. Nếu cùng một recipient vừa là owner của reply target vừa được mention, backend chỉ tạo `message_mention`.
- Cả hai dùng `target_type=MESSAGE`, `target_id` là message mới và `context` có `conversation_id`, `conversation_type`; `reply_to_message_id` có mặt khi message là reply.
- `mention_user_ids` trong `@conversation:send` là optional. Backend merge explicit IDs với `@username` trong content, dedupe và chỉ giữ current group member không phải sender, không bị block hai chiều, không banned/không tồn tại. Direct message trả/lưu danh sách rỗng.
- `GET /api/conversations/:conversation_id/members` thêm additive `is_mentionable` trên từng member để composer lọc đúng policy mà không làm mất member khỏi màn hình quản trị group.
- Thành viên không thuộc directed intent chỉ nhận inbox unread và `@conversation:receive`, không có notification activity item. Mute không suppress `message_reply`/`message_mention` in-app.
- Generic notification legacy `type=message` không còn runtime business caller. Khi directed flag tắt, backend vẫn giao message và cập nhật inbox unread nhưng không tạo generic activity item.

Frontend điều hướng `message_reply`/`message_mention` bằng `context.conversation_id`, sau đó mở/scroll tới `target_id`. Nếu `target_info` là `null`, không tự suy diễn quyền truy cập; refetch conversation/message hoặc bỏ CTA. `@notification:new` vẫn là raw object và retry event không emit item trùng; frontend upsert theo `_id` như các individual notification khác.

### Message Reaction policy (Phase 14 compatibility, Phase 4.2 relevance override)

REST payload của `POST/DELETE /api/conversations/messages/:message_id/react` và `@message:reaction-updated` không đổi; đây là reaction list/summary có thẩm quyền trong Chat. Reaction không tạo outbox notification mới, không tạo `message_reaction`, không xuất hiện trong `GET /api/notifications` và không tăng Notifications badge.

Domain event reaction cũ vẫn được parser nhận để drain outbox compatibility nhưng notification handler luôn trả `suppressed`. Notification `message_reaction` legacy được invalidate bởi policy reconciliation cùng generic `message`; unread state/version được sửa authoritative, không dùng frontend delta.

### Group system message và quyền admin (Phase 15)

Hai REST endpoint additive:

- `POST /api/conversations/:conversation_id/admins/:user_id` cấp admin.
- `DELETE /api/conversations/:conversation_id/admins/:user_id` thu hồi admin; backend chặn sole-admin/race bằng `409` với code `GROUP_ADMIN_REVOKE_CONFLICT`. Grant race trả `GROUP_ADMIN_GRANT_CONFLICT`.

Response thành công giữ envelope chung `{ statusCode, message, data: { success: true } }`. Các route create/add/remove/leave/transfer cũ không đổi request hoặc response.

Khi group-management feature bật (mặc định local), mỗi group mutation có hiệu lực tạo đúng một message additive:

```json
{
  "kind": "system",
  "system_event_type": "member_kicked",
  "affected_user_ids": ["<user_id>"],
  "context": {},
  "content": "Member removed from the group"
}
```

Các value hiện có: `group_created`, `member_added`, `member_left`, `member_kicked`, `admin_granted`, `admin_revoked`, `admin_transferred_and_left`. User message mới ghi `kind=user`; client cũ có thể fallback message thiếu `kind` thành user. System message đi qua `@conversation:receive`, được upsert theo `_id` và tăng unread/inbox giống message khác cho current member trừ actor. Người rời hoặc bị kick không nhận/fetch system message sau removal.

System message là immutable activity: backend từ chối edit, revoke, react, reply hoặc forward. Frontend không hiển thị các action này khi `kind=system`.

`@conversation:group-updated` giữ nguyên shape và bổ sung `change_type` `group_created`, `admin_granted`, `admin_revoked`; các value cũ vẫn giữ. Kick vẫn gửi group-updated cho affected user, nhưng chỉ current member nhận `@conversation:receive`.

Notification direct dùng `group_add`, `group_kick`, `admin_granted`, `admin_revoked`; payload `@notification:new` vẫn là raw notification. `context` có `system_event_type`, `system_message_id`, `affected_user_ids`. Frontend upsert notification theo `_id`; với `group_kick`, hiển thị activity nhưng không đưa CTA mở group nếu `target_info=null`.

### Tweet gốc từ tài khoản đã opt-in (Phase 16)

Frontend đọc trạng thái hiện tại bằng:

```http
GET /api/user/:followed_user_id/follow-notification-preferences
```

Response:

```json
{
  "statusCode": 200,
  "message": "Get follow notification preference successfully",
  "data": { "followed_user_id": "<user_id>", "posts": false }
}
```

Endpoint chỉ trả relation thuộc authenticated caller. Relation không tồn tại hoặc đã unfollow trả `404 FOLLOW_RELATION_NOT_FOUND`; field legacy chưa có giá trị được chuẩn hóa thành `posts=false`.

Frontend bật/tắt bằng:

```http
PATCH /api/user/:followed_user_id/follow-notification-preferences
Content-Type: application/json

{ "posts": true }
```

Response:

```json
{
  "statusCode": 200,
  "message": "Follow notification preference updated successfully",
  "data": { "followed_user_id": "<user_id>", "posts": true }
}
```

Body chỉ nhận boolean `posts`; relation không thuộc caller hoặc đã unfollow trả `404 FOLLOW_RELATION_NOT_FOUND`. Follow mới mặc định false; unfollow xóa preference, frontend xóa cache relation và luôn đọc lại GET khi follow lại.

Khi bật, chỉ tweet gốc `Tweet` audience `Everyone` tạo notification `type=followed_user_tweet`, `target_type=TWEET`, `target_id=<tweet_id>`. Reply, quote, repost, edit, restore và audience khác không tạo item này. Notification đến bất đồng bộ qua `@notification:new`; frontend upsert theo `_id`, không tự cộng unread nếu nhận event trùng, và dùng REST refetch sau reconnect như các type khác.

### Target, message và block lifecycle (Phase 17)

Không có REST endpoint mới và request/response của delete tweet, revoke message, delete-for-me, block/unblock không đổi. Khi `NOTIFICATION_OUTBOX_ENABLED=true` (mặc định local), mutation nghiệp vụ và lifecycle event commit cùng transaction; cleanup notification diễn ra bất đồng bộ:

- Xóa tweet hoặc đổi tweet từ `Everyone` sang audience hạn chế loại notification trỏ trực tiếp tweet đó, notification child có `context.parent_tweet_id` trỏ tweet đó và actor edge repost liên quan.
- Revoke message loại `message_reply` và `message_mention` trỏ message. Delete-for-me chỉ loại item của chính user đã xóa.
- Block loại individual item giữa hai user theo cả hai chiều và gỡ actor của mỗi bên khỏi aggregate của bên kia. Aggregate còn actor phát `@notification:updated`; aggregate rỗng hoặc individual item bị invalidated phát `@notification:removed`.
- Unblock không tái tạo item đã xóa. Event mới giữa hai phía còn block bị suppress.
- Actor bị banned/deleted, user bị block hoặc target mất quyền xem không được hydrate. Trong REST list, backend đồng thời đặt raw `sender_id`/`target_id` bị ẩn thành `null`, lọc actor bị ẩn khỏi `actor_ids_preview`, trả `context={}` và bỏ `deduplication_key`/`aggregation_key` của item bị redact. Frontend không dựng lại identity hoặc route từ cache cũ.
- Cleanup nhiều dữ liệu được chia thành các outbox continuation, tối đa 500 item mỗi transaction. Trong khoảng các page chưa hoàn tất, REST redaction ở trên là lớp bảo vệ contract; frontend có thể nhận nhiều `@notification:removed`/`@notification:updated` liên tiếp và vẫn xử lý từng payload theo `_id`/`version`.

Payload `@notification:removed` giữ contract hiện có:

```json
{
  "notification_id": "<notification_id>",
  "aggregation_key": null,
  "unread_count": 4,
  "version": 27,
  "updated_at": "2026-07-30T10:00:00.000Z"
}
```

`aggregation_key` là `null` với individual item. `unread_count` và `version` có thể vắng nếu item đã đọc nên không có unread transition; khi có, frontend chỉ áp dụng state có version không cũ hơn cache. Individual invalidation có unread transition còn phát `@notification:unread-count` cùng version để giữ compatibility. Luôn remove theo `notification_id`, không tự decrement thêm. Với `@notification:updated`, replace item theo `_id` và không tự thay đổi unread count.

Socket không replay lifecycle event. Sau reconnect, nhiều tab lệch state, hoặc nhận event trùng, refetch trang notification đầu và `/api/notifications/unread-count`; merge/remove theo `_id`, count theo `version`. Trong khoảng worker chưa cleanup xong, REST có thể trả item với `actor_info` hoặc `target_info=null`; frontend không điều hướng bằng dữ liệu bị redact.

### Giới hạn và phần chưa hỗ trợ

- Group bị giới hạn bởi `MAX_GROUP_MEMBERS`, mặc định 500. Frontend không nên cho chọn vượt giới hạn; backend vẫn là nơi enforce cuối cùng.
- Rollout yêu cầu reset đồng thời local `messages`, `conversationReadStates`, `userMessageStates`. Startup fail-fast nếu còn message có `read_by` hoặc ba collection không cùng baseline; backend không backfill/dual-write dữ liệu cũ.
- Notification generic `message` và `message_reaction` chỉ còn là enum/schema compatibility để nhận diện payload hoặc outbox cũ. Runtime không tạo mới; durable feed không trả; frontend không khai báo renderer riêng. Local rollout yêu cầu reset notification data/cache về baseline sạch, không migrate unread state cũ.
- Lifecycle/read-state v2 yêu cầu baseline local sạch cho `notifications`, `notificationActors`, `notificationStates`; startup từ chối actor/state mồ côi, notification thiếu state và active aggregate thiếu actor edge. Backend không infer hoặc migrate notification legacy. Vì vậy frontend local/test cache cũng nên được xóa khi môi trường reset dữ liệu.
- `@conversation:read-state` là best-effort realtime. REST/read-state trong MongoDB là nguồn sự thật.
