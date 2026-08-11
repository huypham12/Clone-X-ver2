# X-ver2 backend

Node.js/TypeScript backend cho X Clone. MongoDB là nguồn dữ liệu bền, Redis phục vụ cache/Socket.IO/BullMQ và notification được xử lý qua typed domain event + transactional outbox.

## Chạy local

Yêu cầu:

- Node.js và dependencies từ `package-lock.json`.
- MongoDB hỗ trợ multi-document transaction.
- Redis TCP cho cache và BullMQ; Socket.IO chỉ dùng Redis khi chọn adapter `redis`.
- File `.env` local hợp lệ. Không commit token, mật khẩu hoặc connection string.

Tạo file cấu hình từ contract mẫu:

```powershell
Copy-Item .env.example .env
```

Trên macOS/Linux, dùng `cp .env.example .env`. Điền MongoDB, Cloudinary và hai JWT secret bắt buộc trước khi start. Sinh riêng từng JWT secret mạnh bằng Node.js (chạy lệnh hai lần, không tái sử dụng cùng một giá trị):

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Các biến collection và feature flag đã có default. Một `REDIS_URL` là đủ cho local; các URL Redis theo capability để trống sẽ fallback về URL này.

```bash
npm ci
npm run build
npm run start:dev
```

Startup kết nối MongoDB, ensure index, kiểm tra read-state/lifecycle baseline, kết nối Redis rồi mới mở HTTP/Socket.IO. Dữ liệu hiện chỉ dùng local/test; nếu startup báo baseline legacy không tương thích, reset đồng thời các collection được nêu trong lỗi thay vì tạo migration:

- `notifications`, `notificationActors`, `notificationStates`;
- `messages`, `conversationReadStates`, `userMessageStates`;
- `tweets` nếu còn Retweet relation trùng trước unique index.

## Redis và runtime preset

Preset portfolio một process trong `.env.example`:

| Capability | Giá trị | Hành vi |
| --- | --- | --- |
| Socket.IO | `SOCKET_ADAPTER_MODE=memory` | Dùng adapter in-memory, không mở Redis pub/sub. |
| Media | `MEDIA_PROCESSING_MODE=inline` | Upload durable lên Cloudinary, hoàn thiện metadata trong request và trả `ready`. |
| Message cache | `CONVERSATION_MESSAGE_CACHE_MODE=off` | Đọc message từ MongoDB và không ghi hydrated message vào Redis. |
| Queue | concurrency `1`, attempts `5` | Giữ tải media worker ở mức bảo thủ. |

`REDIS_CACHE_URL`, `REDIS_QUEUE_URL` và `REDIS_SOCKET_URL` là optional và lần lượt fallback về `REDIS_URL`. Cả `redis://` và `rediss://` đều được chấp nhận; scheme không tự đổi adapter hoặc processing mode. Readiness vẫn ping MongoDB, Redis cache và BullMQ Redis.

Notification và fan-out queue dùng chung exponential backoff. Mỗi queue giữ tối đa `QUEUE_COMPLETED_RETENTION_COUNT=300` job thành công trong 1 giờ và `QUEUE_FAILED_RETENTION_COUNT=500` job lỗi trong 7 ngày. Tăng count bằng env khi có quota lớn hơn, không sửa từng queue.

Chỉ cân nhắc `CONVERSATION_MESSAGE_CACHE_MODE=full` khi Redis transport và mạng đủ tin cậy: mode này lưu hydrated message payload trong sorted set. Portfolio dùng Redis không TLS phải giữ `off`; cache miss, dữ liệu cache lỗi hoặc Redis cache lỗi đều fallback về MongoDB. Presence chỉ lưu user ID/timestamp best-effort có TTL; friend ID cache có TTL 5 phút.

Budget connection mục tiêu của preset portfolio là một `node-redis` cache/presence client, một ioredis base cho queue/publisher, connection nội bộ bắt buộc của từng BullMQ worker đang bật và không có Socket.IO pub/sub connection. Đây không phải tổng hard-code: trước public release, chủ dự án cần đo số connection thực tế trên dashboard Redis hoặc bằng `CLIENT LIST` nếu provider cho phép.

## Media pipeline

Cả hai processing mode đều upload original lên Cloudinary trước; MongoDB chỉ lưu durable URL/public ID và queue không nhận local filepath:

- `inline` là preset portfolio: upload trả `ready` ngay sau khi Cloudinary và MongoDB thành công.
- `queue` dành cho local/VPS: upload trả `pending`, frontend poll `GET /api/media/:media_id`, worker chuyển record sang `ready` hoặc `failed` sau khi hết retry.
- Nếu enqueue hoặc Redis tạm lỗi, record durable vẫn ở `pending`; reconciler quét batch nhỏ và tạo lại deterministic job bị thiếu.
- File tạm được dọn trong `finally`. Nếu Cloudinary thành công nhưng MongoDB insert lỗi, backend thử xóa asset vừa upload.

Giới hạn portfolio mặc định là ảnh/audio 10 MB và video 20 MB, cấu hình bằng `MAX_IMAGE_UPLOAD_MB`, `MAX_AUDIO_UPLOAD_MB` và `MAX_VIDEO_UPLOAD_MB`. Frontend hiện áp dụng đúng các default này; nếu tăng limit backend thì cần đồng bộ giới hạn frontend trước khi public.

## Giới hạn free-tier

- Deploy portfolio dùng một backend instance; Socket.IO memory adapter và realtime notification in-process không hỗ trợ nhiều API instance.
- Redis Cloud Free được chấp nhận không TLS/HA/persistence/backup; không bật full message cache trên transport này.
- Redis là cache/queue có thể phục hồi, không phải nguồn duy nhất của message, notification unread hoặc media source.
- Cold start, quota hosting và tốc độ Cloudinary có thể làm request đầu tiên hoặc upload lâu hơn bình thường.

## Manual smoke trước public release

Các mục sau do chủ dự án kiểm tra trên web; chưa chạy trong implementation này:

1. `NOT VERIFIED — manual smoke required`: preset portfolio với một backend process, Socket.IO memory, notification realtime in-process và media inline.
2. `NOT VERIFIED — manual smoke required`: queue preset local trả `pending` rồi `ready`; restart backend và missing-job reconciliation vẫn hoàn tất media.
3. `NOT VERIFIED — manual smoke required`: Socket.IO adapter `redis` trên một process giữ nguyên room, presence và event contract; không suy ra multi-instance đã pass.
4. `NOT VERIFIED — manual smoke required`: cache `off` vẫn send/receive/paginate chat và Redis không chứa full message payload.
5. `NOT VERIFIED — manual smoke required`: cache `full` với Redis local có cache hit, MongoDB fallback và invalidation đúng.
6. `NOT VERIFIED — manual smoke required`: image/video/audio success và failure đều cleanup file tạm; restart không làm media đã durable mất URL.

Mất sạch Redis và exactly-once toàn hệ thống chỉ là giới hạn được tài liệu hóa, không phải gate portfolio. Để kiểm tra reconciler local, có thể xóa một media job và quan sát deterministic job được tạo lại từ record `pending`.

## Nâng cấp VPS sau này

Chỉ thực hiện khi có nhu cầu scale thật, theo thứ tự:

1. Tách startup composition thành API, notification và media process role.
2. Thêm Redis implementation cho `RealtimeEmitter` và bật Socket.IO Redis adapter trên API.
3. Cấu hình sticky session hoặc WebSocket-only khi chạy nhiều API instance.
4. Tách worker/Redis endpoint và scale concurrency theo số đo.
5. Sau đó mới cân nhắc signed direct upload hoặc storage driver khác.

## Notification backend

Luồng runtime cuối cùng:

```text
business transaction
→ typed domain event + transactional outbox
→ BullMQ worker
→ policy
→ repository + unread state trong transaction
→ Socket.IO delivery sau commit
```

Các notification feature đã hoàn thành và mặc định bật cho local. Có thể tắt riêng để rollback/debug bằng:

- `NOTIFICATION_OUTBOX_ENABLED`
- `NOTIFICATION_FOLLOW_OUTBOX_ENABLED`
- `NOTIFICATION_TWEET_OUTBOX_ENABLED`
- `NOTIFICATION_SOCIAL_AGGREGATION_ENABLED`
- `NOTIFICATION_MESSAGE_DIRECTED_ENABLED`
- `NOTIFICATION_GROUP_MANAGEMENT_ENABLED`
- `NOTIFICATION_FOLLOWED_TWEET_ENABLED`

`NOTIFICATION_OUTBOX_ENABLED=false` tạm dừng publisher/worker nhưng không xóa pending outbox. Message event vẫn commit cùng message; khi bật lại, backlog được xử lý theo các handler flag đang có. Đây là pause có thể replay, không phải discard event.

Không còn unread rollout flag hoặc fallback `countDocuments`; `NotificationState` là nguồn runtime cho notification badge. `ConversationReadState` và `UserMessageState` là nguồn runtime cho inbox unread; message mới không đọc hoặc dual-write `Message.read_by`.

Contract tích hợp frontend nằm tại [frontend-notification-contract.md](./frontend-notification-contract.md). Danh sách endpoint tóm tắt ở [endpoint.md](./endpoint.md), OpenAPI ở [swagger.yaml](./swagger.yaml).

## Kiểm tra Phase 18

```bash
npx tsc --noEmit
npm run build
npm run lint
npm run test:notification-handoff
```

`test:notification-handoff` là static audit: kiểm tra caller bypass, module boundary, source unread, index bootstrap, ownership/privacy marker, Socket implementation, fan-out enqueue boundary, feature default và độ phủ contract. Phase 18 không chạy load test, fault injection, benchmark hoặc multi-instance verification; backend hiện được xác nhận local/contract-ready, không được mô tả là production-ready.
