# X-ver2 backend

Node.js/TypeScript backend cho X Clone. MongoDB là nguồn dữ liệu bền, Redis phục vụ cache/Socket.IO/BullMQ và notification được xử lý qua typed domain event + transactional outbox.

## Chạy local

Yêu cầu:

- Node.js và dependencies từ `package-lock.json`.
- MongoDB hỗ trợ multi-document transaction.
- Redis cho cache, Socket.IO adapter và BullMQ.
- File `.env` local hợp lệ. Không commit token, mật khẩu hoặc connection string.

```bash
npm install
npm run build
npm run start:dev
```

Startup kết nối MongoDB, ensure index, kiểm tra read-state/lifecycle baseline, kết nối Redis rồi mới mở HTTP/Socket.IO. Dữ liệu hiện chỉ dùng local/test; nếu startup báo baseline legacy không tương thích, reset đồng thời các collection được nêu trong lỗi thay vì tạo migration:

- `notifications`, `notificationActors`, `notificationStates`;
- `messages`, `conversationReadStates`, `userMessageStates`;
- `tweets` nếu còn Retweet relation trùng trước unique index.

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
- `NOTIFICATION_MESSAGE_REACTION_ENABLED`
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
