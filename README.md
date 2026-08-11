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
| Media | `MEDIA_PROCESSING_MODE=inline` | Contract mặc định; thay đổi media orchestration thuộc phase con riêng. |
| Message cache | `CONVERSATION_MESSAGE_CACHE_MODE=off` | Đọc message từ MongoDB và không ghi hydrated message vào Redis. |
| Queue | concurrency `1`, attempts `5` | Giữ tải media worker ở mức bảo thủ. |

`REDIS_CACHE_URL`, `REDIS_QUEUE_URL` và `REDIS_SOCKET_URL` là optional và lần lượt fallback về `REDIS_URL`. Cả `redis://` và `rediss://` đều được chấp nhận; scheme không tự đổi adapter hoặc processing mode. Readiness vẫn ping MongoDB, Redis cache và BullMQ Redis.

Notification và fan-out queue dùng chung exponential backoff. Mỗi queue giữ tối đa `QUEUE_COMPLETED_RETENTION_COUNT=300` job thành công trong 1 giờ và `QUEUE_FAILED_RETENTION_COUNT=500` job lỗi trong 7 ngày. Tăng count bằng env khi có quota lớn hơn, không sửa từng queue.

Chỉ cân nhắc `CONVERSATION_MESSAGE_CACHE_MODE=full` khi Redis transport và mạng đủ tin cậy: mode này lưu hydrated message payload trong sorted set. Portfolio dùng Redis không TLS phải giữ `off`; cache miss, dữ liệu cache lỗi hoặc Redis cache lỗi đều fallback về MongoDB. Presence chỉ lưu user ID/timestamp best-effort có TTL; friend ID cache có TTL 5 phút.

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
