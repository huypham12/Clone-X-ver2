# Kế hoạch hardening và deploy portfolio trên nền tảng miễn phí

> Phạm vi tài liệu: lập kế hoạch hoàn thiện và deploy hai repository `X-ver2` và `X-frontend` để dùng làm portfolio phỏng vấn. Mục tiêu là một bản demo công khai ổn định, trung thực về giới hạn và có chất lượng code tốt; không tuyên bố đạt chuẩn production thương mại. Hạ tầng đích dùng các dịch vụ managed/free-tier, không có VPS riêng và không giả định có persistent filesystem.
>
> **Phần do chủ dự án tự thực hiện, không nằm trong phạm vi triển khai của kế hoạch này:** CI cho mỗi push và nhóm integration test Login/refresh, conversation authorization, message retry, notification unread/read và block direct-message. Kết quả của các phần đó có thể được gắn vào release gate cuối, nhưng các phase dưới đây không tự tạo CI hoặc integration test thay chủ dự án.

## 1. Mục tiêu cuối cùng

Sau khi hoàn thành kế hoạch, dự án phải đạt trạng thái sau:

1. Có URL frontend và backend công khai; frontend gọi đúng API HTTPS và Socket.IO cùng backend.
2. Các luồng chính auth (đăng ký rồi đăng nhập ngay, không xác minh email), tweet, follow/block, direct/group chat, realtime, notification và media chạy được trên môi trường deploy thật.
3. Frontend và backend đều typecheck, build và lint thành công; không còn script package trỏ tới file không tồn tại.
4. Không log email-verify/forgot-password/reset-password token hoặc JWT ra stdout của nền tảng deploy, kể cả trong code email đang bị vô hiệu hóa.
5. `npm audit --omit=dev` không còn advisory mức high có bản vá khả dụng trong runtime dependency; ngoại lệ bắt buộc phải có ghi chú reachability và lý do chưa thể nâng.
6. Hai repo có `.env.example` không chứa secret và README đủ để interviewer hiểu kiến trúc, chạy local, xem demo và biết giới hạn free-tier.
7. Backend có liveness/readiness endpoint phù hợp với health probe, không bị global rate limiter làm trả `429`.
8. Frontend production build không cần tải Google Fonts trong lúc build.
9. Redis Cloud Free được dùng đúng giới hạn 30 MB/30 connection/100 ops mỗi giây: BullMQ dùng Redis TCP, queue có retention nhỏ, MongoDB/outbox là nguồn phục hồi và không đưa payload chat nhạy cảm vào Redis không TLS.
10. Không còn BullMQ job phụ thuộc vào đường dẫn file local có thể biến mất sau sleep/restart của PaaS.
11. Có tài khoản demo hoặc quy trình tạo tài khoản demo rõ ràng, không commit credential nhạy cảm hay dữ liệu cá nhân thật.

Luồng triển khai đích:

```text
Browser
  ├── HTTPS → Vercel Hobby: Next.js frontend
  └── HTTPS/WebSocket → Render Free Web Service: backend (một instance)
                           ├── MongoDB Atlas Free: dữ liệu bền + transaction + outbox
                           ├── Redis Cloud Essentials Free: BullMQ + cache phi nhạy cảm
                           └── Cloudinary Free: media bền
```

## 2. Giới hạn chủ động

Kế hoạch này không yêu cầu:

- VPS, Kubernetes, multi-region hoặc autoscaling nhiều backend instance.
- Tách API, notification worker, fan-out worker và media worker thành nhiều process/service. Phase 6 chỉ làm sạch dependency boundary để không khóa đường nâng cấp; process role và cross-process realtime chỉ triển khai khi thật sự chuyển sang VPS.
- Load test quy mô lớn, chaos engineering, SLO/SLA hoặc hệ thống metrics/trace hoàn chỉnh.
- Migration framework để bảo toàn dữ liệu local cũ.
- Bao phủ integration/E2E test tự động; phần integration test đã được chủ dự án nhận tự làm.
- Đổi toàn bộ auth sang refresh token `HttpOnly` trong release này. Đây vẫn là technical debt cần ghi trong README, không được mô tả là security production hoàn chỉnh.
- Triển khai mọi endpoint backend thành UI; edit/forward message và grant/revoke admin có thể tiếp tục là capability backend chưa có UI.
- Dùng dịch vụ ping bên ngoài để né chính sách sleep của free-tier.
- Gửi email, xác minh email, quên mật khẩu hoặc reset mật khẩu trong bản portfolio này. Người dùng mới được coi là verified như code đăng ký hiện tại và có thể đăng nhập ngay; README phải nói rõ giới hạn này.

## 3. Baseline đã xác minh

### 3.1. Kiểm tra kỹ thuật

| Hạng mục                             | Baseline                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Frontend TypeScript                  | Pass                                                                         |
| Frontend production build            | Pass khi có mạng; hiện tải Geist từ Google Fonts lúc build                   |
| Frontend lint                        | Fail: 20 error, 19 warning                                                   |
| Backend TypeScript/build             | Pass                                                                         |
| Backend notification handoff audit   | Pass: 138 TypeScript file, 17 notification type, 7 feature default           |
| Backend notification relevance audit | Pass                                                                         |
| Backend lint                         | Fail: 1 error và 716 warning chủ yếu Prettier/line ending                    |
| `test:conversation-foundation`       | Fail vì thiếu `tsconfig.test.json` và `tests/conversation-foundation.test.*` |
| Frontend runtime dependency audit    | 12 advisory: 9 high, 3 moderate tại thời điểm lập kế hoạch                   |
| Backend runtime dependency audit     | 19 advisory: 13 high, 6 moderate tại thời điểm lập kế hoạch                  |

### 3.2. Điểm tốt có thể giữ nguyên

- Backend dùng MongoDB làm nguồn dữ liệu bền và có transactional outbox cho notification.
- Notification worker có retry/idempotency và REST reconciliation sau socket reconnect.
- Socket.IO đã dùng personal room; frontend có logic reconnect và refetch state.
- Startup backend kết nối MongoDB, ensure index và kết nối Redis trước khi listen.
- Backend đã có graceful shutdown cho HTTP, queue, worker, Redis và MongoDB.
- Media image/audio đã upload Cloudinary và xóa file tạm sau khi hoàn thành.
- `.env` hiện được ignore ở cả hai repo và worktree sạch tại baseline.

### 3.3. Release blocker hiện tại

1. Reset-password token bị log trong `src/modules/auth/auth.controller.ts` và `src/modules/auth/services/auth.service.ts`.
2. Frontend còn metadata mặc định `Create Next App` và phụ thuộc `next/font/google` khi build.
3. Backend env bắt buộc cả những biến không thuộc release scope như Resend/SendGrid/Google/`HOST`, làm deploy free-tier khó cấu hình và dễ dùng dummy secret; frontend vẫn còn đường dẫn UI email dù đăng ký hiện tại đã auto-verify.
4. Backend dùng ba connection `node-redis` cho cache + Socket.IO pub/sub, ngoài các connection BullMQ/worker.
5. Video queue lưu `filepath` của ephemeral filesystem trong Redis; restart có thể để lại job bền nhưng mất file nguồn.
6. Global rate limiter đang đứng trước mọi route; health probe quá thường xuyên có thể tự làm health endpoint trả `429` nếu chỉ thêm route mà không đổi middleware order.
7. Chưa có health endpoint, `.env.example`, backend deploy artifact hoặc tài liệu free-tier/cold-start.

## 4. Quyết định kiến trúc cho portfolio free-tier

### 4.1. Stack deploy chốt cho bản portfolio

Stack đề xuất được chốt theo ngày **2026-08-10**; quota/chính sách phải kiểm tra lại trên trang chính thức lúc tạo service:

| Thành phần | Lựa chọn mặc định           | Quyết định triển khai                                                                                                                                                                 |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | Vercel Hobby                | Root `X-frontend`, deploy Next.js native; chỉ dùng cho portfolio cá nhân/non-commercial.                                                                                              |
| Backend    | Render Free Web Service     | Root `X-ver2`, một instance hỗ trợ HTTP + WebSocket; chấp nhận sleep/cold start.                                                                                                      |
| Database   | MongoDB Atlas Free          | Database demo riêng; phải chạy thử transaction thật trước deploy vì code dùng `withTransaction()`.                                                                                    |
| Redis      | Redis Cloud Essentials Free | Redis 8.2, RESP2, 30 MB/30 connection/100 ops/s, `no eviction`; không HA/persistence/backup/TLS nên Mongo outbox/media pending là nguồn phục hồi và không cache full message payload. |
| Media      | Cloudinary Free             | Lưu image/video/audio bền; local disk chỉ là temp trong một request.                                                                                                                  |
| Email      | Không triển khai            | Không tạo provider/secret; register auto-verified và login ngay.                                                                                                                      |

Lý do không cố nhét mọi thứ vào một host: frontend hợp với Vercel, backend realtime cần long-running process/WebSocket, còn MongoDB/Redis/media cần dịch vụ managed riêng. Đây vẫn là một topology không cần VPS.

Tài liệu tham chiếu khi chốt: [Vercel pricing](https://vercel.com/pricing), [Render free services](https://render.com/docs/free), [Render Docker](https://render.com/docs/docker), [Redis Cloud Free plans](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/), [Redis Cloud TLS](https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/), [MongoDB Atlas Free](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/) và [Cloudinary pricing](https://cloudinary.com/pricing).

### 4.2. Portfolio deploy một instance, worker chạy cùng process

- Chỉ triển khai một long-running Node.js web service có hỗ trợ WebSocket; không triển khai backend vào serverless function thuần request/response.
- Notification worker, fan-out worker và outbox publisher tiếp tục chạy cùng API process để không cần thêm service trả phí.
- Media worker queue nếu bật cũng chạy cùng process. Phase này không thêm process role hoặc script start worker riêng.
- `NOTIFICATION_OUTBOX_ENABLED=true` trên môi trường demo; không bật legacy writer song song.
- Free-tier có thể sleep. Khi backend sleep, WebSocket ngắt và queue không được xử lý; sau khi service thức lại, frontend reconnect và outbox publisher tiếp tục xử lý backlog từ MongoDB.
- README phải nói rõ cold start/realtime interruption là giới hạn hosting, không phải bảo đảm always-on.

### 4.3. Redis Cloud Free: cấu hình đã chọn và giới hạn chấp nhận

Redis dùng cho BullMQ phải đáp ứng:

- Có connection string Redis TCP dùng được bởi `node-redis` và `ioredis`; không dùng REST endpoint.
- Hỗ trợ persistent TCP connection, Pub/Sub và blocking command mà BullMQ cần.
- Database portfolio dùng Redis **8.2**, chọn **RESP2** để tương thích bảo thủ với cả `node-redis`, `ioredis` và BullMQ hiện tại.
- Đổi dashboard `Data eviction policy` từ `volatile-lru` sang **`no eviction`**. Khi đầy 30 MB, write phải fail rõ thay vì Redis xóa ngẫu nhiên queue/cache key.
- Free tier không có HA, data persistence, remote backup hoặc TLS. Đây là giới hạn cố định, không điền giả hay mô tả nhầm là đã bật.
- Production URL dùng scheme `redis://`, được giữ duy nhất trong Render secret manager. Không dùng `rediss://` vì free database không cung cấp TLS.
- Default user phải có password ngẫu nhiên mạnh; rotate password trước public release và ngay khi nghi ngờ URL từng xuất hiện trong log/screenshot/source.
- CIDR allow list đang không có trên cấu hình free này, nên không dành thời gian thử nghiệm trước release. Password mạnh, secret manager và giới hạn dữ liệu Redis là control thực tế của bản portfolio.
- Vì transport không mã hóa, Redis portfolio chỉ chứa queue identifier/cursor, cache ID/presence best-effort. Không cache access/refresh token, credential, full message body hoặc dữ liệu riêng tư khác.
- `no eviction` không tạo persistence. MongoDB/outbox vẫn là nguồn khôi phục khi Redis mất state; free Redis không được mô tả là durable queue production.

Checklist dashboard hiện tại:

| Setting                   | Giá trị chốt                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Name                      | Đổi thành `clone-x-portfolio`                                                                                           |
| Version                   | Giữ `8.2`                                                                                                               |
| Protocol                  | Đổi `RESP3` → `RESP2`                                                                                                   |
| Eviction                  | Đổi `volatile-lru` → `no eviction`                                                                                      |
| HA / persistence / backup | `None` / Off — giới hạn free, chấp nhận có ghi chú                                                                      |
| TLS                       | Off — giới hạn free, không giả vờ dùng `rediss://`                                                                      |
| Region                    | AWS Singapore nếu Render ở Singapore; nếu database hiện ở Virginia và vẫn 0 key/0 connection thì tạo lại trước khi dùng |

### 4.4. Socket.IO adapter theo capability, realtime cùng process

Thêm cấu hình:

```text
SOCKET_ADAPTER_MODE=memory   # memory | redis
```

- `memory`: chỉ dùng in-memory Socket.IO adapter. `io.in(userId).allSockets()` vẫn đúng trong một API process và không mở hai connection Redis pub/sub.
- `redis`: mở `pubClient`/`subClient` và Redis adapter; giữ mode này hoạt động để không phải khôi phục code khi sau này chạy nhiều instance, nhưng portfolio không bật.
- Notification delivery được inject qua một interface nhỏ nhưng release này chỉ có implementation in-process. Không thêm Redis emitter, emitter factory hoặc cross-process config khi worker vẫn chạy cùng Socket.IO server.
- Cache Redis và BullMQ vẫn hoạt động khi Socket.IO dùng `memory`. Không tự bật adapter chỉ vì có Redis URL.
- Sticky session/WebSocket-only và cross-process emitter được ghi trong hướng nâng cấp VPS, không phải gate Phase 6.

Budget connection mục tiêu ở mode portfolio:

```text
1 node-redis cache/presence
1 ioredis base dùng cho Queue/publisher
+ connection nội bộ bắt buộc của từng BullMQ Worker đang bật
0 Socket.IO pub/sub connection khi single-instance
```

Không hard-code tổng cuối cùng dựa trên giả định thư viện. Phase Redis phải đo số connection thật trên dashboard/provider hoặc `CLIENT LIST` nếu provider cho phép, rồi ghi con số vào README vận hành.

Redis URL được tách theo capability nhưng có fallback để portfolio chỉ cần một secret:

```text
REDIS_URL                # bắt buộc, fallback chung
REDIS_CACHE_URL          # optional, fallback REDIS_URL
REDIS_QUEUE_URL          # optional, fallback REDIS_URL
REDIS_SOCKET_URL         # optional, fallback REDIS_URL
```

Không thêm `FREE_TIER=true` hoặc tự đổi mode theo CPU/RAM. Mode được chọn rõ lúc deploy; concurrency, retention và upload limit mới là các nút điều chỉnh tải.

### 4.5. Redis không là nguồn sự thật

| Dữ liệu                    | Nguồn sự thật                   | Redis mất/flush thì sao                                                  |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Notification/outbox        | MongoDB                         | Publisher có thể enqueue lại theo event id                               |
| Notification unread        | MongoDB `NotificationState`     | REST trả lại state                                                       |
| Conversation unread        | MongoDB read-state              | REST reconcile lại badge                                                 |
| Message/conversation cache | MongoDB                         | Cache miss và hydrate lại                                                |
| Presence/last seen         | Redis, best-effort              | Có thể mất trạng thái tạm thời                                           |
| BullMQ notification job    | Redis + event id/outbox MongoDB | Notification có thể redeliver từ outbox; không được `FLUSHDB` tùy tiện   |
| BullMQ media job           | Redis + `MediaMetadata` pending | Reconciler có thể enqueue lại theo media id và durable Cloudinary source |

Không dùng Redis free-tier để giữ dữ liệu duy nhất không thể tái tạo.

### 4.6. Media pipeline có hai mode, cùng dùng durable source

Thêm cấu hình `MEDIA_PROCESSING_MODE=inline|queue`; portfolio dùng `inline`, còn `queue` được giữ hoạt động và kiểm tra local để có thể dùng khi chuyển sang VPS.

Luồng chung của cả hai mode:

1. Backend nhận file tạm với giới hạn dung lượng cấu hình được.
2. Upload original lên Cloudinary trước; chỉ `secure_url/public_id` mới là source bền.
3. `inline`: hoàn thiện thumbnail/metadata trong request rồi lưu `ready`.
4. `queue`: lưu `MediaMetadata.status=pending` kèm durable Cloudinary reference, sau đó BullMQ xử lý bằng job versioned không chứa `filepath`; frontend tiếp tục poll endpoint media như hiện tại.
5. Reconciler quét media `pending` có durable reference và bảo đảm có deterministic BullMQ job. Media record là nguồn phục hồi vừa đủ cho quy mô hiện tại, không tạo thêm collection/outbox framework thứ hai.
6. File tạm luôn được xóa trong `finally`; nếu Cloudinary thành công nhưng DB insert thất bại thì thực hiện best-effort compensating delete để hạn chế orphan asset.

Queue mode hiện chỉ chịu trách nhiệm hoàn thiện metadata/thumbnail và tạo seam an toàn cho transform sau này; không tuyên bố đã có transcoding/moderation nếu chưa triển khai. Direct-to-Cloudinary signed upload và storage driver S3/MinIO chưa thuộc release này vì cần thêm security contract, frontend flow và vận hành storage. Khi thật sự cần, chúng được thêm qua storage interface thay vì sửa controller.

Không giữ nguyên khối code cũ dưới dạng comment. Worker `filepath` không an toàn được thay bằng implementation compile/test được; comment chỉ ghi invariant “queued source phải durable”, còn lịch sử cũ đã có Git lưu giữ.

### 4.7. Health check không đánh thức hoặc làm quá tải dependency

- `GET /health/live`: chỉ chứng minh process/event loop còn trả response; không ping MongoDB/Redis.
- `GET /health/ready`: ping MongoDB, Redis cache và BullMQ Redis với timeout ngắn; trả `503` nếu dependency bắt buộc chưa sẵn sàng.
- Health response chỉ có status/timestamp và tên dependency, không trả URI, database name, collection, secret hoặc error stack.
- Health route được mount trước global API limiter. Không dùng health probe để cố tình giữ free service luôn thức.

### 4.8. Auth portfolio không phụ thuộc email

- Giữ đúng hành vi đăng ký hiện tại: account mới được lưu ở trạng thái verified và nhận token để có thể đăng nhập ngay, không gửi email.
- Gỡ các route email khỏi public runtime: resend/verify email và forgot/verify/reset password. Không để UI dẫn tới một feature cố ý không triển khai.
- Gỡ khởi tạo email provider và các email secret khỏi env contract/deploy dashboard. Không dùng dummy SendGrid/Resend key.
- Có thể giữ field verify/token cũ trong schema để tránh migration không cần thiết, nhưng không giữ code path nửa hoạt động hoặc mô tả email là feature của demo.
- Vẫn xóa toàn bộ log raw token trong source trước khi vô hiệu hóa route; code dormant không được phép chứa lỗi lộ secret rõ ràng.
- Đổi password khi đã đăng nhập vẫn thuộc scope nếu code/UI hiện có; password recovery khi mất quyền đăng nhập là known limitation.

### 4.9. Policy nâng dependency

- Không chạy `npm audit fix --force` trên toàn repo.
- Tách frontend/backend thành commit riêng; trong mỗi repo tách patch/minor update khỏi breaking update.
- Gỡ dependency trực tiếp không dùng trước khi thêm override.
- Với transitive advisory, ưu tiên nâng package cha/lockfile; chỉ dùng `overrides` khi package cha cho phép và build/runtime đã được kiểm tra.
- Sau mỗi nhóm update chạy `npm ci`, typecheck, build, lint, static audit và manual smoke phần liên quan.
- Audit count là snapshot theo ngày; gate dựa vào audit chạy lại ở thời điểm release, không dựa vào số trong tài liệu.

## 5. Portfolio release rule và nguyên tắc chia phase

Mục tiêu của release này là tạo một bản demo public ổn định, dễ đánh giá và dễ rollback với lượng thay đổi nhỏ nhất hợp lý; không phải tái thiết kế hệ thống để đạt chuẩn production tuyệt đối.

Khi có nhiều phương án, ưu tiên theo thứ tự:

1. Ít thay đổi code nhất nhưng vẫn xử lý đúng blocker.
2. Ít dependency và hạ tầng mới nhất.
3. Dễ kiểm tra và rollback nhất.

Không redesign subsystem hoặc nâng major framework chỉ để đạt một chỉ số đẹp. Technical debt không chặn build, deploy hoặc luồng demo bắt buộc được chuyển vào `Known limitations`, không tự động trở thành release blocker.

Mỗi việc được phân loại trước khi làm:

- **Release blocker:** lộ secret/token, build/lint fail, deploy không khởi động, dữ liệu/media lỗi rõ ràng, hoặc một luồng demo bắt buộc không dùng được.
- **Should fix:** cải thiện độ tin cậy đáng kể với thay đổi nhỏ, rủi ro thấp và dễ rollback.
- **Document only:** hardening production, edge case hiếm hoặc cải tổ kiến trúc không cần để interviewer trải nghiệm dự án.

- Mọi phase bắt đầu với `git status`; không trộn formatting toàn repo với thay đổi nghiệp vụ.
- Mỗi phase có commit/rollback riêng và không tự sửa CI/integration test thuộc phần chủ dự án nhận làm.
- Không dùng disable ESLint diện rộng để “đạt pass”; exception phải ở đúng dòng và có lý do kỹ thuật.
- Không commit `.env`, token, connection string, tài khoản Cloudinary hoặc credential demo.
- Không dùng fake env value cho biến thực tế không được code sử dụng; phải loại biến unused khỏi config hoặc đánh dấu optional.
- Không mô tả free-tier demo là production-ready/always-on.
- Smoke test deploy dùng dữ liệu demo riêng, không dùng email định danh thật hoặc mật khẩu có giá trị ở nơi khác.

## Bước chuẩn bị — Khóa release baseline

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Ghi lại trạng thái trước khi hardening để mỗi phase có thể chứng minh không làm regress tính năng.

**Công việc**

1. Lưu output của:
   - frontend: `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm audit --omit=dev`;
   - backend: `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm run test:notification-handoff`, `npm run test:notification-relevance`, `npm audit --omit=dev`.
2. Ghi Node/npm version đang dùng; chọn một Node LTS được cả Next.js và backend hỗ trợ.
3. Chụp contract hiện tại của login, refresh, media upload, `/notifications`, `/conversations/unread-summary` và socket send acknowledgement.
4. Chuẩn bị ba account demo A/B/C trên database không chứa dữ liệu thật.
5. Ghi danh sách env key hiện tại mà không ghi value.
6. Ghi số Redis connection local sau khi backend đã start đủ worker để so với Phase 6.

**Không làm trong bước này**

- Không nâng package, format hoặc sửa code.
- Không chạy integration test có mutation vào database không phải test/demo.

**Gate hoàn thành**

- Có baseline command/output và account matrix A/B/C.
- Hai worktree được ghi nhận rõ trước khi sửa.

**Rollback**

- Không cần; bước này không thay source/data ngoài dữ liệu demo chủ động tạo.

---

## Phase 1 — Loại bỏ secret/token logging và làm sạch runtime env contract

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Không để token nhạy cảm xuất hiện trong log công khai của free hosting và không bắt deploy cung cấp dummy secret cho feature không dùng.

**Phụ thuộc**

- Bước chuẩn bị.

**File sửa**

- `src/modules/auth/auth.controller.ts`: xóa log forgot-password token.
- `src/modules/auth/services/auth.service.ts`: xóa log token trong reset password.
- `src/modules/auth/auth.route.ts` và bootstrap liên quan: không mount route resend/verify email, forgot/verify/reset password; không khởi tạo email provider trong release runtime.
- `src/modules/auth/services/email.service.ts` và wiring/provider liên quan: gỡ khỏi runtime portfolio; chỉ giữ lại code nếu hoàn toàn dormant, không cần env và không còn raw-token log.
- Frontend auth routes/components: bỏ link/banner/navigation tới forgot/reset/verify email để không quảng cáo feature cố ý tắt; register success dẫn người dùng sang login theo hành vi hiện tại.
- `src/config/getEnvConfig.ts`: phân loại required/optional/default theo runtime consumer thật.
- `package.json`: gỡ `resend`, SendGrid SDK và provider package khác sau khi không còn source import.

**Quy tắc env**

- Nếu `MONGODB_URI` có giá trị, không bắt buộc `DB_USERNAME`, `DB_PASSWORD`, `DB_CLUSTER_HOST`.
- Nếu dùng cấu hình rời thì mới yêu cầu username/password/cluster.
- `PORT` có default; không bắt buộc `HOST` nếu code không dùng.
- Loại `RESEND_API_KEY`, `SENDGRID_API_KEY`, `EMAIL_FROM` và email-only token expiry/secret khỏi release env contract.
- Google OAuth env chỉ required khi có route/feature thật; nếu không có consumer thì loại khỏi release env contract.
- Secret validation fail-fast nhưng error chỉ nêu tên key thiếu, không in value.

**Kiểm tra có mục tiêu**

```text
rg "console\.(log|error).*token|console\.log\(token\)" src
```

- Dùng `rg` xác nhận không còn log token; gọi các URL email cũ và xác nhận không có public feature nửa hoạt động (trả `404` theo contract đã chọn, không gửi mail và không log token).
- Register một account mới, xác nhận account được auto-verified như code hiện tại rồi login thành công mà không cần email delivery.
- Start backend với `MONGODB_URI` và không có DB user/password rời.
- Start backend thiếu một secret thật sự bắt buộc và xác nhận fail-fast an toàn.

**Gate hoàn thành**

- Không còn log raw token trong auth path.
- Backend/frontend không còn public route hoặc CTA email bị hỏng; registration → login chạy ngay.
- Backend start với tập env tối thiểu, không cần dummy Resend/SendGrid/Google/HOST.
- Typecheck/build pass.

**Rollback**

- Revert env parser/auth routing nếu cần; không khôi phục email provider hoặc bất kỳ token log nào trong release portfolio.

---

## Phase 2 — Đưa lint về pass và sửa package script không trung thực

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Hai repo có command lint đáng tin cậy; package scripts không quảng cáo một test suite không tồn tại.

**Phụ thuộc**

- Phase 1 để tránh format/lint lại code auth hai lần.

### 2.1. Frontend lint

**Nhóm lỗi phải sửa bằng code**

1. `no-explicit-any` trong auth/search/tweet/user component:
   - dùng `unknown`, `AxiosError<ApiErrorBody>` hoặc type response cụ thể;
   - không đổi rule thành off toàn repo.
2. `react-hooks/set-state-in-effect`:
   - state có thể derive thì bỏ state/effect;
   - dialog cần reset form thì reset tại open handler hoặc remount boundary có key;
   - logic async validate token giữ effect nhưng chỉ set state từ callback/transition hợp lệ.
3. `react/no-unescaped-entities`: escape text JSX.
4. `exhaustive-deps`: ổn định callback/dependency, không thêm disable nếu closure thật sự có thể stale.
5. `no-img-element`: ưu tiên `next/image` cho ảnh nội dung; ảnh viewer đặc thù được targeted disable có comment nếu tối ưu hóa làm sai behavior.

**File trọng điểm theo baseline**

- `src/features/auth/components/*`.
- `src/features/media/components/viewers/MediaLightbox.tsx` và media upload hook.
- `src/features/search/components/*`.
- `src/features/tweets/components/*`.
- `src/features/users/components/*`.

### 2.2. Backend lint/format

- Bỏ useless try/catch trong `src/utils/cloudinary.ts`.
- Chốt line ending `LF` bằng `.gitattributes`/Prettier để Windows và Linux cho cùng kết quả.
- Chạy format thành commit riêng, sau đó mới lint logic; không review lẫn 700 thay đổi line-ending với security/dependency diff.
- Giữ `dist`, `.test-dist`, `node_modules`, upload temp ngoài lint/format.

### 2.3. Broken test script

Quyết định mặc định:

- Xóa `test:conversation-foundation` khỏi `package.json` vì `tsconfig.test.json` và test source không tồn tại.
- Không tạo test rỗng hoặc test luôn pass để giữ tên script.
- Khi chủ dự án hoàn thành integration tests thủ công/riêng, thêm script mới trỏ tới file có thật trong commit của phần đó.
- Giữ các static verification script notification đang chạy được.

**Gate hoàn thành**

```text
X-frontend: npm run lint → exit 0
X-ver2: npm run lint → exit 0
X-ver2: npm run prettier → exit 0
```

- `package.json` không còn command trỏ tới file thiếu.
- Typecheck/build của hai repo vẫn pass.

**Rollback**

- Revert từng nhóm frontend/backend độc lập.
- Formatting commit có thể revert độc lập; không rollback bằng cách disable lint rule toàn cục.

---

## Phase 3 — Dependency cleanup và bản vá tối thiểu

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Loại bỏ dependency không dùng và áp dụng các bản vá patch/minor cần thiết cho runtime công khai. Phase này không cố đưa mọi advisory về 0, không nâng major và không thay đổi kiến trúc.

**Phụ thuộc**

- Phase 2 để lint/build là regression gate.

### 3.1. Cách thực hiện giới hạn

Chỉ thực hiện hai batch, một cho mỗi repository:

1. **Backend:** dùng `rg` xác nhận dependency trực tiếp không có consumer rồi gỡ cùng type package liên quan; cập nhật Express, Socket.IO, JWT và YAML trong major hiện tại.
2. **Frontend:** cập nhật Next.js và `eslint-config-next` đồng bộ tới bản stable nhỏ nhất sửa advisory; giữ Axios/Socket.IO client nếu bản hiện tại đã an toàn; chỉ chuyển package sang `devDependencies` khi source/build không import package đó trực tiếp.

Quy tắc tiết kiệm thời gian và token:

- Chỉ audit một lần ở baseline và một lần sau khi hoàn tất cả hai batch; không in toàn bộ JSON nếu chỉ cần count/path.
- Chỉ cập nhật lockfile một lần cho mỗi repository; không chạy `npm ci` sau từng package hoặc từng advisory.
- Không dùng `npm audit fix --force`, không thêm override transitive và không nâng major trong phase này.
- Chạy toàn bộ gate đúng một vòng cuối. Nếu một gate lỗi, chỉ sửa và chạy lại gate đó, tối đa hai lần trước khi dừng và ghi blocker.
- Advisory chỉ có breaking fix hoặc không reachable được ghi nhận; không tiếp tục lặp command chỉ để đạt audit count bằng 0.

### 3.2. Gate cuối duy nhất

Frontend:

```text
npm ci
npx tsc --noEmit
npm run build
npm run lint
npm audit --omit=dev
```

Backend:

```text
npm ci
npx tsc --noEmit
npm run build
npm run lint
npm run test:notification-handoff
npm run test:notification-relevance
npm audit --omit=dev
```

Sau gate, chạy `npm ls --omit=dev --depth=0` một lần ở mỗi repo và smoke có mục tiêu cho login, Socket.IO connect và media upload nếu dependency liên quan đã đổi.

**Gate hoàn thành**

- Không còn high advisory runtime reachable có fix patch/minor hoặc removal an toàn.
- Không có dependency direct rõ ràng không dùng; `npm ls` exit 0 và không có direct dependency invalid/missing. Optional platform artifact do npm cài cho native package không chặn gate nếu lockfile hợp lệ.
- Lockfile khớp package manifest; frontend/backend typecheck, build và lint pass.
- Static notification handoff/relevance backend pass.
- Advisory còn lại, nếu có, được ghi rõ reachability và lý do chấp nhận.

**Kết quả triển khai 2026-08-11**

- Backend gỡ các package không có source consumer, chuyển type package về `devDependencies`, cập nhật Express/JWT/Socket.IO/YAML và các transitive patch trong range.
- Frontend cập nhật đồng bộ Next.js/ESLint config lên `16.3.0`; giữ `shadcn` trong `dependencies` vì `globals.css` import `shadcn/tailwind.css`, đồng thời cập nhật các transitive advisory trong range.
- `npm audit --omit=dev`: backend `0`, frontend `0`.
- Typecheck/build/lint hai repo pass; frontend còn một lint warning không chặn release tại `src/services/api.client.ts`.
- Notification handoff và notification relevance backend pass.
- Không khởi động MongoDB/Redis/Cloudinary chỉ để smoke dependency patch; login, Socket.IO và media smoke trên môi trường đầy đủ vẫn thuộc P0 của Phase 8.

**Rollback**

- Backend và frontend là hai batch độc lập, có thể revert riêng.
- Không giữ override gây duplicate major hoặc peer-dependency invalid.

---

## Phase 4 — `.env.example`, Node version và frontend build tái lập

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Một người lạ có thể cấu hình hai repo mà không xem `.env` thật; build frontend không phụ thuộc mạng font.

**Phụ thuộc**

- Phase 1 đã chốt env contract.
- Phase 3 đã chốt dependency/Node engine.

### 4.1. Frontend

**File tạo/sửa**

- `.env.example`: chỉ chứa `NEXT_PUBLIC_API_URL=http://localhost:4000/api` và comment format production.
- `.gitignore`: thêm `!.env.example` sau rule `.env*`; nếu không, file example mới vẫn bị Git bỏ qua.
- `src/app/layout.tsx`: thay `next/font/google` bằng `next/font/local`.
- Thêm Geist WOFF2 cần dùng vào repo từ nguồn chính thức, kèm license/attribution; chỉ giữ weight thực sự dùng.
- Cập nhật metadata title/description/Open Graph cơ bản từ `Create Next App` thành X.
- Pin Node major bằng `engines` và một file version dùng chung theo host được chọn.

**Gate**

- Chặn network rồi `npm run build` vẫn pass.
- Không còn request tới `fonts.googleapis.com`/`fonts.gstatic.com`.
- Không có font layout shift rõ ràng ở login/home/messages.

### 4.2. Backend

**`.env.example` phải chia nhóm**

```text
# App/CORS
PORT
CORS_ORIGIN
NODE_ENV hoặc startup --env
TRUST_PROXY_HOPS

# MongoDB
MONGODB_URI
DB_NAME
DB_*_COLLECTION (optional, có default)

# Redis
REDIS_URL
# Phase 6 sở hữu các capability mode/URL mở rộng

# Notification feature flags
NOTIFICATION_*

# Auth secrets + expiry
PASSWORD_SECRET
JWT_SECRET_ACCESS_TOKEN
JWT_SECRET_REFRESH_TOKEN
ACCESS_TOKEN_EXPIRES_IN
REFRESH_TOKEN_EXPIRES_IN

# Cloudinary/media limits
CLOUDINARY_*
MAX_IMAGE_UPLOAD_MB
MAX_VIDEO_UPLOAD_MB
MAX_AUDIO_UPLOAD_MB
```

- Example chỉ dùng placeholder, không dùng credential giống thật.
- Sửa `.gitignore` thành vẫn ignore `.env`/`.env.*` nhưng có exception `!.env.example`, rồi xác nhận `git status` nhìn thấy file example.
- README ghi cách sinh secret mạnh, không đưa secret mẫu dùng được.
- Không đưa SendGrid/Resend/email verification/forgot-password secret vào `.env.example`; các feature đó không thuộc runtime portfolio.
- Collection env có default phải được ghi optional; không bắt người deploy nhập hàng chục tên collection nếu không cần.
- Pin cùng Node major tương thích frontend/backend.
- Danh sách trên là contract đã hoàn thành ở Phase 4; Phase 6 mở rộng `.env.example` bằng Redis/realtime/media mode và retention/concurrency knob, không hồi tố gate Phase 4.

**Gate hoàn thành**

- Copy `.env.example` thành env local, điền đúng các secret bắt buộc là đủ start app.
- `git grep` không tìm thấy secret/value từ `.env` thật trong tracked files.
- Frontend offline build và backend build pass.

**Rollback**

- Font local có thể rollback sang system font stack; không rollback về build bắt buộc gọi Google Fonts.

---

## Phase 5 — Health/readiness và hành vi đúng sau reverse proxy

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Hosting có endpoint probe chính xác, không bị limiter/CORS/proxy làm sai trạng thái.

**Phụ thuộc**

- Phase 4 có env contract.

**File tạo mới**

- `src/modules/health/health.route.ts`.
- `src/modules/health/health.service.ts` chỉ khi cần tách một dependency check nhỏ, có timeout.

**File sửa**

- `src/app.ts`: middleware order, mount health route và cấu hình `trust proxy`.
- `src/config/database.service.ts`: method ping không làm query collection nghiệp vụ.
- `src/config/redis.service.ts`: method ping/status cho cache client.
- `src/config/redisConfig.ts`: method ping/status cho BullMQ Redis.
- `src/config/getEnvConfig.ts`: parse `TRUST_PROXY_HOPS` an toàn.
- `swagger.yaml`, `endpoint.md`: mô tả health endpoints nếu quyết định public contract.

**Middleware order đích**

```text
CORS/helmet
→ health live/ready (không global rate limit)
→ JSON parser + API rate limit
→ auth/user/media/tweet/conversation/search/notification
→ API docs
→ 404/error handler
```

**Contract tối thiểu**

- `GET /health/live`: process đang chạy thì trả `200`, không gọi dependency.
- `GET /health/ready`: ping MongoDB và Redis với timeout ngắn; tất cả sẵn sàng thì `200`, ngược lại `503`.
- Route health nằm ngoài global rate limiter và không yêu cầu auth.
- Không thêm readiness state machine, SIGTERM transition hoặc cache kết quả probe trong portfolio release này.

**Response tối thiểu**

```json
{
  "status": "ready",
  "checks": {
    "mongodb": "up",
    "redis": "up"
  }
}
```

Không trả hostname nội bộ, URI, database name, queue payload hoặc stack.

**Gate hoàn thành**

- Live trả `200` và không bị global limiter.
- Ready trả `200` khi MongoDB/Redis đúng; một lần kiểm tra cấu hình dependency sai trả `503` và không lộ chi tiết kết nối.
- Sau config đúng, API và Socket.IO vẫn hoạt động.
- `X-Forwarded-For` qua proxy không làm mọi user dùng chung IP sai do thiếu `trust proxy`.

**Rollback**

- Có thể bỏ readiness dependency details và giữ liveness đơn giản; không đặt health sau global limiter.

---

## Phase 6 — Redis/media ổn định, giữ đường nâng cấp VPS nhưng không triển khai topology phân tán

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Giảm connection/memory cho portfolio, giữ nguyên realtime, tách media boundary và loại queue phụ thuộc disk tạm. Phase này làm code upgrade-ready nhưng không triển khai process role, cross-process emitter hoặc multi-service topology chưa được dùng.

**Phụ thuộc**

- Phase 5 cung cấp health state.
- Redis Cloud Free đã được tạo; region, version, RESP, eviction, connection/memory/ops quota và giới hạn không TLS/persistence được ghi lại.
- MongoDB vẫn là nguồn sự thật cho message/unread/notification; Cloudinary là source media bền duy nhất trong release này.

**Giới hạn để không over-engineer**

- Chỉ implement `CloudinaryMediaStorage`; tạo storage interface vì controller hiện đang phụ thuộc trực tiếp Cloudinary, nhưng chưa thêm `MEDIA_STORAGE_DRIVER` khi chưa có implementation thứ hai.
- Chỉ giữ backend multipart upload. Signed direct upload, webhook Cloudinary, S3/MinIO và CDN tự host được ghi là extension point, không nằm trong gate portfolio.
- Implement thật `MEDIA_PROCESSING_MODE=inline|queue` vì frontend đã hỗ trợ `pending/ready/failed` và backend đã có BullMQ video worker; không thêm mode giả hoặc flag chưa có runtime path.
- Queue mode upload original lên Cloudinary trước rồi mới enqueue post-processing. Nó không được quảng cáo là làm upload network nhanh hơn; lợi ích là source bền, retry được và có chỗ mở rộng thumbnail/transform.
- Không tự chuyển mode theo CPU/RAM. Mỗi deployment chọn mode rõ; tải được điều chỉnh bằng concurrency, retention, size limit và rate limit.
- Không tạo media outbox collection/framework mới. `MediaMetadata` pending có `public_id` là durable work record; một reconciler nhỏ bảo đảm deterministic job tồn tại. Notification outbox hiện tại không bị tổng quát hóa chỉ để phục vụ một loại job media.
- Không comment-out nguyên khối worker cũ. Code `filepath` không an toàn được thay thế; invariant và extension point được ghi bằng type/comment ngắn và README, lịch sử implementation cũ nằm trong Git.
- Không thêm `PROCESS_ROLE`, Redis realtime emitter, emitter factory, worker-only entry point hoặc split-process smoke. Notification worker/fan-out/media worker tiếp tục chạy cùng API process trong release portfolio.

**Thứ tự thực hiện trong Phase 6**

```text
6.1 config + Redis lifecycle
  → 6.2 cache/retention
  → 6.3 realtime seam in-process
  → 6.4 media service + inline
      → 6.5 durable media queue
  → 6.6 docs + manual smoke checklist
```

Mỗi phase con có gate riêng; có thể dừng an toàn sau 6.4 và deploy inline nếu queue mode 6.5 gặp blocker. Hướng tách process chỉ được ghi trong README như future upgrade, không tạo code path chưa dùng.

**Nguyên tắc verification Phase 6**

- AI không tạo test file, integration/E2E test hoặc verification script mới cho Phase 6.
- Sau mỗi phase con, AI chỉ chạy typecheck/build/lint đã có và liên quan trực tiếp; không chạy toàn bộ audit/test suite theo thói quen.
- Invariant tĩnh như mode guard, Redis URL fallback, queue payload không có `filepath`, deterministic job id và không có import worker cũ được kiểm tra trực tiếp trên source/diff, không viết script để soi lại source.
- Các hành vi cần service/credential hoặc thao tác nhiều bước như upload thật, Socket.IO realtime, cache hit/fallback, restart/reconcile và đo dashboard Redis là manual smoke của chủ dự án.
- Manual smoke chưa được chủ dự án chạy phải báo `NOT VERIFIED — manual smoke required`; không dựng thêm môi trường hoặc test harness để biến nó thành PASS.
- Static audit đã tồn tại chỉ chạy khi thay đổi trực tiếp chạm contract mà audit đó sở hữu; Phase 6 không bắt chạy toàn bộ notification audit một cách máy móc.

### 6.1. Config contract và lazy Redis lifecycle

**Nghiệp vụ**

Cho portfolio dùng một Redis URL/một process nhưng vẫn có mode rõ cho cache, queue và Socket.IO; chỉ mở connection thực sự cần, không thêm process-role config.

**File sửa**

- `src/config/getEnvConfig.ts`:
  - parse enum nghiêm ngặt cho `SOCKET_ADAPTER_MODE=memory|redis`, `MEDIA_PROCESSING_MODE=inline|queue` và `CONVERSATION_MESSAGE_CACHE_MODE=off|full`;
  - thêm `REDIS_CACHE_URL`, `REDIS_QUEUE_URL`, `REDIS_SOCKET_URL` optional và fallback về `REDIS_URL`;
  - parse positive integer có min/max hợp lý cho upload size, worker concurrency, attempts và retention;
  - không log URL/credential; error chỉ nêu tên biến hoặc mode sai.
- `src/config/redis.service.ts`:
  - cache client dùng `REDIS_CACHE_URL` fallback;
  - pub client dùng `REDIS_SOCKET_URL`, sub client duplicate từ pub; chỉ tạo/connect cả hai khi socket mode là `redis`;
  - getter/status typed an toàn và shutdown idempotent chỉ đóng client đã tạo;
  - log connection name/trạng thái, không log URL.
- `src/config/redisConfig.ts`:
  - BullMQ dùng `REDIS_QUEUE_URL` fallback;
  - giữ `maxRetriesPerRequest=null`, `lazyConnect` và connect/disconnect idempotent;
  - không thêm queue factory/process-role lifecycle khi toàn bộ worker vẫn chạy cùng process.
- `src/socket/index.ts`:
  - `memory` giữ default adapter và log `single-instance in-memory adapter`;
  - `redis` yêu cầu pub/sub ready rồi mới gắn adapter;
  - room, auth middleware, event name và presence contract không đổi.
- `src/modules/health/health.service.ts`: readiness vẫn kiểm tra MongoDB, Redis cache và BullMQ Redis của một backend process; không thêm health topology theo role.
- `src/app.ts`: dùng connect/close API idempotent mới nhưng giữ một startup path và graceful shutdown hiện tại.
- `.env.example`: thêm các biến trên với default portfolio; không thêm `PROCESS_ROLE` hoặc `REALTIME_DELIVERY_MODE`.
- `README.md`: thêm bảng preset, không tạo biến `FREE_TIER=true`.

**Config mặc định portfolio**

```text
SOCKET_ADAPTER_MODE=memory
MEDIA_PROCESSING_MODE=inline
CONVERSATION_MESSAGE_CACHE_MODE=off
MEDIA_WORKER_CONCURRENCY=1
MEDIA_QUEUE_MAX_ATTEMPTS=5
QUEUE_COMPLETED_RETENTION_COUNT=300
QUEUE_FAILED_RETENTION_COUNT=500
MAX_IMAGE_UPLOAD_MB=10
MAX_VIDEO_UPLOAD_MB=20
MAX_AUDIO_UPLOAD_MB=10

REDIS_URL=redis://localhost:6379
# REDIS_CACHE_URL / REDIS_QUEUE_URL / REDIS_SOCKET_URL để trống → fallback REDIS_URL
```

**Validation bắt buộc**

- Chỉ chấp nhận các enum đã hỗ trợ thật; không giữ tên biến adapter boolean cũ song song.
- `memory + inline + cache off` là preset portfolio.
- `queue` yêu cầu BullMQ Redis và durable Cloudinary config; worker vẫn được start trong cùng process.
- Chấp nhận cả `redis://` và `rediss://`; không suy ra TLS hoặc adapter mode từ scheme.

**Đóng góp cho kiến trúc đề xuất**

Portfolio giảm connection; Redis endpoint có thể tách trên VPS mà không sửa business code. Không phải bảo trì process topology hoặc emitter chưa dùng.

**AI verification phase con**

- Typecheck/build/lint phần config, Redis lifecycle và Socket.IO liên quan pass.
- Review source xác nhận `memory` không tạo Socket pub/sub; `redis` chỉ gắn adapter sau khi client ready.
- Review source xác nhận cache/queue/socket URL fallback đúng, shutdown idempotent và log/error không lộ URL/credential.
- Review source xác nhận enum/config sai bị từ chối và không còn tên biến adapter boolean cũ song song.

### 6.2. Giảm Redis data/retention và cache message có mode thật

**Nghiệp vụ**

Giảm memory free-tier, không đưa full chat payload qua Redis không TLS và tập trung queue defaults để sau này tăng quota không phải sửa nhiều file.

**File tạo mới**

- `src/queues/queue-options.ts`: đóng gói exponential backoff và `removeOnComplete/removeOnFail` dùng chung, nhận attempts override theo từng queue; tránh notification, fan-out và media queue drift cấu hình.

**File sửa**

- `src/queues/notification.queue.ts`, `src/queues/notification-fanout.queue.ts`: dùng shared queue options; default completed khoảng 300 job/1 giờ và failed khoảng 500 job/7 ngày cho mỗi queue.
- `src/modules/conversation/conversation-message-delivery.service.ts`: chỉ `zAdd` hydrated message khi cache mode là `full`; mode `off` bỏ cache write nhưng vẫn emit realtime.
- `src/modules/conversation/conversation.service.ts`: mode `off` đi thẳng MongoDB; mode `full` mới đọc sorted-set và mọi cache error đều fallback MongoDB.
- `src/modules/conversation/conversation-message-sync.service.ts`: invalidate cache là best-effort, không làm mutation nghiệp vụ fail.
- `src/socket/index.ts`: friend/presence cache chỉ chứa ID/timestamp; bổ sung TTL/giới hạn cần thiết, không cache token/full profile.
- `.env.example`, `README.md`: ghi retention knobs, rủi ro `full` mode và yêu cầu chỉ cân nhắc bật khi Redis transport/mạng tin cậy.

**Không làm trong phase này**

- Không thêm cache mode `metadata` khi chưa có query chứng minh cần nó.
- Không chạy `KEYS *`, `FLUSHALL`, `FLUSHDB` hoặc key-prefix migration toàn hệ thống.

**Đóng góp cho kiến trúc đề xuất**

Redis trở thành cache/queue có thể tái tạo; portfolio tiết kiệm memory, còn VPS vẫn có lựa chọn bật full cache có chủ đích thay vì phải khôi phục code đã xóa.

**AI verification phase con**

- Typecheck/build/lint các file cache/queue liên quan pass.
- Review source xác nhận mode `off` bỏ cả read/write full message cache nhưng không bỏ realtime; mode `full` có read/write/invalidate và catch để fallback MongoDB.
- Review source xác nhận notification/fan-out queue dùng shared options và không còn retention 10.000–50.000 hard-code.

### 6.3. Tạo realtime delivery seam tối thiểu, chỉ implement in-process

**Nghiệp vụ**

Giữ nguyên realtime hiện tại nhưng bỏ phụ thuộc trực tiếp của notification business service vào global `getIO()`. Phase này tạo điểm thay thế cho VPS sau này, không implement cross-process delivery.

**File tạo mới**

- `src/modules/realtime/realtime-emitter.ts`: interface tối thiểu `emit(room, event, payload)`; không đưa notification business type vào transport contract.
- `src/modules/realtime/in-process-realtime-emitter.ts`: adapter dùng Socket.IO server hiện tại.

**File sửa**

- `src/modules/notification/notification-delivery.service.ts`: inject `RealtimeEmitter`; giữ nguyên event name/payload và semantics `delivered`.
- `src/modules/notification/notification.service.ts`, `src/modules/notification/notification.worker.ts`, `src/modules/notification/notification-fanout.worker.ts`, `src/modules/notification/directed-notification-read.service.ts`: truyền delivery dependency qua constructor; outer/default composition dùng `InProcessRealtimeEmitter`, không tạo Redis transport hoặc route factory mới.

Chat send/typing/read chạy trong API process nên vẫn dùng Socket.IO server trực tiếp ở release này; không refactor toàn bộ chat qua emitter khi chưa có worker chat riêng.

**Không làm trong phase này**

- Không tạo Redis emitter/factory, không thêm package mới và không thêm `REALTIME_DELIVERY_MODE`.
- Không tách notification worker khỏi Socket.IO process và không tuyên bố cross-process realtime đã được support.

**Đóng góp cho kiến trúc đề xuất**

Notification delivery dễ test/thay transport hơn mà frontend không đổi socket event, room hoặc REST reconciliation. Khi chuyển VPS, Redis emitter có thể implement interface này mà không sửa notification domain.

**AI verification phase con**

- Typecheck/build/lint các notification/realtime file liên quan pass.
- Review source xác nhận notification services/workers không gọi trực tiếp `getIO()` ngoài in-process adapter.
- Review package/env diff xác nhận không có dependency/config Redis emitter mới.

### 6.4. Tách media business flow và hoàn thiện inline mode

**Nghiệp vụ**

Làm controller mỏng, gom invariant durable upload/DB/cleanup vào service và giữ inline mode đơn giản cho deploy portfolio.

**File tạo mới**

- `src/modules/media/media-storage.port.ts`: contract upload/delete và durable result (`secure_url`, `public_id`, resource type); đây là seam để sau này thêm storage khác mà không sửa controller.
- `src/modules/media/cloudinary-media.storage.ts`: implementation Cloudinary duy nhất của release.
- `src/modules/media/media-processor.port.ts`: contract finalize media độc lập transport.
- `src/modules/media/inline-media.processor.ts`: hoàn thiện thumbnail/metadata và trả `ready` ngay trong request.
- `src/modules/media/media.service.ts`: orchestration upload → process → persist/compensate; controller không gọi Cloudinary/queue trực tiếp.

**File sửa**

- `src/modules/media/media.controller.ts`: parse auth/request, gọi `MediaService`, map response; image/video/audio dùng chung error/cleanup policy.
- `src/utils/file.ts`: limit từ env, validate đúng field/MIME, trả danh sách temp file và cleanup helper; quyền xóa temp thuộc `MediaService`, không để parser/storage cùng xóa một file.
- `src/utils/cloudinary.ts`: chuyển thành primitive async-safe dùng bởi storage adapter hoặc gộp vào adapter; bỏ `unlink` khỏi Cloudinary primitive để không double-cleanup hoặc che upload error chính.
- `src/schemas/MediaMetadata.schema.ts`, `src/constants/enums/media.enum.ts`: giữ contract `pending|ready|failed`; không thêm state chỉ để trang trí. Inline chỉ ghi `ready` khi có durable URL/public id.
- `src/modules/media/dto/index.ts`, `swagger.yaml`, `endpoint.md`: mô tả response có thể `ready` hoặc `pending` tùy mode nhưng shape không đổi.

**Failure semantics**

- Cloudinary fail: không tạo media `ready`, temp file vẫn bị xóa.
- Cloudinary success nhưng DB fail: best-effort delete asset vừa upload và trả lỗi; lỗi cleanup được log riêng.
- Delete media: Cloudinary `success/not_found` mới tiếp tục xóa DB; pending worker thấy record không còn thì no-op, không hồi sinh record đã xóa.

**Đóng góp cho kiến trúc đề xuất**

Portfolio có flow ít dependency, chịu restart tốt hơn; sau này đổi upload/processor không cần viết lại controller hoặc ba flow image/video/audio.

**AI verification phase con**

- Typecheck/build/lint các file media liên quan pass.
- Review source/diff xác nhận controller không gọi Cloudinary/queue trực tiếp, temp cleanup nằm trong `finally`, DB failure có compensating delete và không ghi `ready` thiếu durable URL/public id.

### 6.5. Thay video filepath worker bằng durable media queue và reconciler nhỏ

**Nghiệp vụ**

Giữ queue mode chạy thật để dùng trên VPS nhưng source luôn nằm trên Cloudinary; dùng media record pending làm recovery source thay vì xây thêm outbox framework.

**File tạo mới**

- `src/modules/media/media-processing-job.type.ts`: versioned payload chỉ chứa `media_id` và durable `{provider, public_id}`; comment invariant cấm local/absolute `filepath`.
- `src/queues/media-processing.queue.ts`: Queue factory/name/job id deterministic theo media id + version, dùng shared queue options.
- `src/modules/media/bullmq-media.processor.ts`: enqueue/finalize implementation của `MediaProcessor`; không nhận local path.
- `src/modules/media/media-processing.worker.ts`: đọc lại media từ MongoDB, kiểm tra durable reference, xử lý idempotent và conditional update `pending → ready`.
- `src/modules/media/media-processing-reconciler.ts`: định kỳ quét batch nhỏ media `pending` có `public_id`, bảo đảm job missing được enqueue lại; có interval/batch cố định bảo thủ hoặc env nếu thực sự cần tuning.

**File sửa/xóa**

- `src/schemas/MediaMetadata.schema.ts`: nếu cần chỉ thêm field vận hành nhỏ như `processing_attempts`/`last_error`; không lưu queue payload lớn hoặc secret.
- `src/config/database.service.ts`: index `{status: 1, updated_at: 1}` phục vụ scan pending có giới hạn; không tạo collection mới.
- `src/modules/media/media.service.ts`: queue mode upload Cloudinary trước, lưu `pending` với durable reference rồi để reconciler/processor dispatch.
- `src/modules/media/media.controller.ts`: không import queue trực tiếp.
- `src/queues/video.queue.ts`: xóa sau khi caller đã chuyển hết; không để commented worker hoặc production import cũ.
- `src/app.ts`: cùng process chỉ start/close media queue, reconciler và worker khi mode là `queue`; inline mode không start media worker.
- `package.json`: không thêm test/verification script hoặc start script theo process role.

**Semantics queue tối thiểu**

- Worker hiện chỉ hoàn thiện metadata/thumbnail đang có; không thêm transcoding/moderation giả.
- Sau khi lưu pending, API thử enqueue ngay bằng deterministic job id; enqueue lỗi không làm mất durable work record và reconciler sẽ thử lại.
- Retry dùng job id deterministic và update có điều kiện nên enqueue/chạy lặp không tạo media thứ hai.
- Chỉ chuyển `failed` khi đã hết attempts; lỗi tạm thời tiếp tục retry.
- Redis mất job: media vẫn `pending` và reconciler enqueue lại. Cloudinary source/Mongo record không mất.
- Media bị xóa khi job còn chờ: worker thấy record không còn/hết quyền xử lý thì no-op thành công, không tạo lại record.

**Đóng góp cho kiến trúc đề xuất**

Queue mode không còn gắn với disk của process; VPS có thể tăng concurrency, còn việc tách worker được hoãn mà không phải đổi API/media schema. Recovery đủ thực tế cho project hiện tại mà không chạm notification outbox phức tạp.

**AI verification phase con**

- Typecheck/build/lint các file media queue liên quan pass.
- Review source/diff xác nhận job DTO, caller và log không có local/absolute `filepath`; job id deterministic và queue dùng shared retention.
- Review source xác nhận worker update có điều kiện, media missing là no-op và app không còn import worker cũ.

### 6.6. Đồng bộ frontend/API docs và bàn giao manual smoke checklist

**Nghiệp vụ**

Đồng bộ contract người dùng và bàn giao checklist ngắn để chủ dự án tự kiểm tra trên web; AI không dựng test harness hoặc tự động hóa smoke matrix.

**File frontend kiểm tra/sửa khi cần**

- `X-frontend/src/features/media/types/media.type.ts`: giữ `pending|ready|failed` đồng bộ backend.
- `X-frontend/src/features/media/api/media.service.ts`: không giả định upload luôn trả `pending` hoặc luôn `ready`.
- `X-frontend/src/features/media/hooks/useMediaUpload.ts`: inline `ready` kết thúc ngay; queue `pending` tiếp tục poll, timeout không tự biến thành backend `failed`.
- `X-frontend/src/features/media/components/MediaPreviewGrid.tsx`: giữ processing/error/retry UX; không thêm UI direct upload trong release này.

**File tài liệu sửa**

- `swagger.yaml`, `endpoint.md`: hai media response semantics, `GET /media/:id` polling và error status.
- `.env.example`, `README.md`: preset single-process, Redis URL fallback, connection budget, queue retention, recovery, giới hạn free-tier và mục “nâng cấp VPS sau này”.
- `phase-release.md`: đánh dấu phase con sau khi AI verification pass; manual smoke được báo trạng thái riêng.

**Future upgrade notes, không phải code scope**

README chỉ ghi thứ tự khi có nhu cầu thật:

1. Tách startup composition thành API/notification/media process role.
2. Thêm Redis implementation cho `RealtimeEmitter` và bật Socket.IO Redis adapter trên API.
3. Cấu hình sticky session hoặc WebSocket-only nếu chạy nhiều API instance.
4. Tách worker/Redis endpoint và scale concurrency theo số đo.
5. Chỉ sau đó cân nhắc signed direct upload hoặc storage driver khác.

Không tạo file runtime role, package script worker-only hay dependency emitter trong Phase 6.

**Manual smoke checklist của chủ dự án**

1. Portfolio preset: một backend process, socket memory, notification realtime in-process, media inline.
2. Queue preset local: cùng backend process bật media queue; upload trả pending rồi ready, restart backend/worker lifecycle và missing-job reconciliation.
3. Socket adapter `redis` local: một process vẫn giữ room/presence/event contract; không tuyên bố đã smoke multi-instance.
4. Cache `off`: chat send/receive/pagination đúng và Redis không có full message.
5. Cache `full` trên local Redis: cache hit/fallback/invalidation đúng; không dùng mode này trên Redis Cloud Free không TLS.
6. Image/video/audio success/failure cleanup; backend restart không làm media đã durable mất URL.

Checklist này không phải gate AI. Mục chưa được chủ dự án chạy được ghi `NOT VERIFIED — manual smoke required`; không yêu cầu AI tự dựng service, credential, dữ liệu hoặc client để chạy thay.

Diễn tập mất sạch Redis và chứng minh exactly-once toàn hệ thống vẫn là **document only**, không phải release gate portfolio. Nếu chủ dự án muốn kiểm tra reconciler, chỉ cần xóa một media job local và quan sát job được tạo lại; notification tiếp tục dựa trên outbox hiện có.

**Gate hoàn thành Phase 6**

- Typecheck/build/lint liên quan trực tiếp pass bằng script đã có; không tạo test hoặc verification script mới.
- Review source/diff xác nhận Redis URL/mode/lifecycle đúng, cache `off` không ghi full message và queue không còn retention lớn hard-code.
- Review source/diff xác nhận production media queue payload/caller không có local `filepath`, media source là durable và worker/reconciler giữ semantics idempotent.
- Review source/diff xác nhận notification phát qua in-process `RealtimeEmitter`; không có Redis emitter/process-role code hoặc dependency chưa dùng.
- Env example, README, frontend type/flow và API docs đồng bộ với implementation.
- Manual smoke chưa chạy không làm AI implementation fail; báo rõ từng mục `NOT VERIFIED — manual smoke required` để chủ dự án kiểm tra trên web trước public release.

**Rollback**

- Portfolio giữ một process với `memory + inline + cache off`; rollback từng capability bằng config mà không quay lại worker chứa filepath.
- Nếu queue mode gặp lỗi, chuyển `MEDIA_PROCESSING_MODE=inline` sau khi xử lý/reconcile media pending; không bỏ mặc record pending và không xóa Redis/Mongo tùy tiện.
- Không rollback về full message cache trên Redis không TLS hoặc queue media dùng ephemeral filepath.

---

## Phase 7 — Repository release preparation

**Trạng thái: Đã hoàn thành.**

**Mục tiêu**

Hoàn thành toàn bộ code, artifact, deploy-as-code và tài liệu có thể xác minh trước khi tạo managed service. Sau Phase 7, hai repository ở trạng thái **CODE READY**: chỉ còn nhập credential, deploy và kiểm tra runtime thật.

Phase này là repository-owned/local preparation, không gọi là “AI 100%”: Docker build/start vẫn là gate bắt buộc và cần Docker daemon, nhưng không cần tài khoản Render, Vercel, MongoDB Atlas hoặc Redis Cloud để hoàn thành implementation.

**Phụ thuộc**

- Phase 3–6.
- Backend và frontend là hai Git repository độc lập. Khi deploy riêng, root directory của mỗi project là repository root (`.` hoặc để trống trong UI), không phải `X-ver2`/`X-frontend`.

### 7.1. Backend Docker artifact

- `Dockerfile`: multi-stage trên Node 22 Debian slim; build stage chạy `npm ci` + compile `dist`, runtime chỉ cài production dependency và chạy user non-root.
- Runtime image copy `dist`, `package*.json` và `swagger.yaml`; không copy `.env`, source, test hoặc tài liệu kế hoạch.
- Tạo/chown `uploads/images/temp`, `uploads/videos`, `uploads/audios` để user non-root ghi trong thời gian request; các thư mục vẫn ephemeral.
- `CMD ["npm", "run", "start:prod"]`; không dùng nodemon và không cần override Docker command.
- `.dockerignore` loại `.git`, `node_modules`, `dist`, `.env*`, uploads local, log, test output và tài liệu không cần runtime.
- `package.json` giữ Node engine, build/start command rõ; Swagger không được làm startup fail do thiếu file hoặc working directory khác.

Container chỉ cần writable temp directory nhỏ cho multipart; không thêm persistent volume hoặc đưa local filepath trở lại media queue.

### 7.2. Docker Compose chỉ dành cho local

- `docker-compose.yml` tiếp tục là Redis helper local, không deploy lên Render và không chạy Redis container production song song với Redis Cloud.
- Bỏ trường Compose `version` cũ; dùng Redis 8.2 Alpine, bind `127.0.0.1:6379:6379` và không expose ra LAN/Internet.
- Bật AOF `appendonly yes`, `appendfsync everysec`, volume riêng và `maxmemory-policy noeviction`.
- Có healthcheck `redis-cli ping`; backend local dùng `REDIS_URL=redis://localhost:6379`.
- Backend service/profile là optional; Redis service phải vẫn chạy độc lập cho workflow `npm run dev`.

### 7.3. Render Blueprint và production env contract

- Tạo `render.yaml` ở root backend repository để giữ cấu hình ổn định: web service, `runtime: docker`, free plan, Singapore, một instance, `healthCheckPath: /health/ready` và dùng `CMD` từ image.
- Vì backend là repository riêng, không set `rootDir: X-ver2`; `dockerfilePath` là `./Dockerfile` hoặc bỏ để dùng default repo root.
- Các secret/credential (`MONGODB_URI`, `REDIS_URL`, Cloudinary, JWT) chỉ khai báo tên bằng `sync: false`; không hard-code value, không dùng Docker build arg và không log URI.
- Các default portfolio không nhạy cảm được ghi rõ: `SOCKET_ADAPTER_MODE=memory`, `MEDIA_PROCESSING_MODE=inline`, `CONVERSATION_MESSAGE_CACHE_MODE=off`, worker concurrency/attempts/retention và notification feature flags.
- `CORS_ORIGIN` là giá trị runtime phải chốt ở Phase 8 sau khi frontend custom domain hoạt động; target của release này là exact origin `https://x.cacbonat.top`, không dùng `*` cùng credentials.
- Vercel dùng native Next.js deployment. Không tạo `vercel.json` nếu code không cần rewrite/header/runtime override; frontend repository root là project root.
- Deploy guide mô tả Render/Vercel/MongoDB/Redis/Cloudinary từng bước nhưng để URL, credential, quota quan sát và ngày đo cho Phase 8–9.

Quota/chính sách provider là dữ liệu thay đổi: Phase 7 chỉ ghi expectation và link tài liệu chính thức, không đóng đinh connection/ops/timeout chưa được dashboard xác nhận.

**Custom-domain contract của release này**

```text
https://x.cacbonat.top             → Vercel frontend
https://api.x.cacbonat.top         → Render backend API + Socket.IO
https://api.x.cacbonat.top/api     → frontend API base URL
```

- Phase 7 chỉ chuẩn bị env contract, deploy guide và code tương thích; không tạo DNS record, add domain vào provider hoặc tuyên bố HTTPS/domain đã hoạt động.
- Domain được truyền qua runtime/build environment, không hard-code vào source. Production target là `NEXT_PUBLIC_API_URL=https://api.x.cacbonat.top/api` và `CORS_ORIGIN=https://x.cacbonat.top`.
- Domain mặc định `.vercel.app`/`.onrender.com` có thể tiếp tục tồn tại như provider endpoint/fallback, nhưng không là URL portfolio chính sau khi custom domain đã được Phase 8 xác minh.
- Không hard-code loại record hoặc DNS target. Deploy guide yêu cầu copy chính xác record/target do Vercel và Render hiển thị khi add custom domain.

### 7.4. Frontend artifact và cold-start handling

- Production env contract chỉ có public `NEXT_PUBLIC_API_URL`; target của deployment này là `https://api.x.cacbonat.top/api`. Không đặt backend secret trong bất kỳ `NEXT_PUBLIC_*` variable nào.
- Thêm trạng thái `Đang khởi động máy chủ demo…` khi health/bootstrap chưa phản hồi; không phát toast lỗi chung lặp lại.
- Retry `/health/live` hoặc bootstrap request bằng backoff có giới hạn và có nút thử lại; không treo vô hạn hoặc dùng keep-alive để lách free-tier.
- Chỉ xóa session khi refresh/login trả `401` xác thực rõ ràng. Timeout, network error, `502` hoặc `503` không được tự logout user.
- Socket giữ reconnect; sau khi backend ready phải refetch notification state và conversation unread summary.

**File frontend trọng điểm**

- `src/features/auth/components/auth-initializer.tsx` hoặc bootstrap auth tương đương.
- API client/interceptor xử lý refresh và transient network error.
- Socket provider/reconnect hook.
- Component trạng thái demo-server ở màn hình khởi tạo.

### 7.5. README, architecture và deploy guide trước deployment

Hoàn thiện từ Phase 7 mọi nội dung suy ra được từ code; Phase 9 không nghiên cứu lại repository:

- Frontend README: tên dự án, feature highlights, stack, sơ đồ frontend ↔ API/Socket ↔ MongoDB/Redis/BullMQ/Cloudinary, local setup, scripts, self-registration và known limitations đã biết.
- Backend README: single-process portfolio topology, WebSocket/transaction requirement, Redis modes/URL fallback/retention, Docker/Compose, env matrix, health/deploy commands, notification outbox, media durable source/reconciliation, rollback và auth scope.
- Dùng “portfolio deployment” hoặc “production-like demo”, không tự nhận production-ready.
- Section demo dùng nhãn rõ `URL sẽ được điền sau Phase 8`, không tạo broken link hoặc mô tả placeholder như deployment thật.
- README/deploy guide ghi topology dự kiến `x.cacbonat.top` → Vercel và `api.x.cacbonat.top` → Render, nhưng đánh dấu `NOT VERIFIED` cho tới khi DNS và HTTPS pass ở Phase 8.
- Chọn self-registration cho release này; không thêm `demo:seed` hoặc lifecycle credential công khai. Registration auto-verified/login ngay và không có email recovery phải được mô tả rõ.
- Mermaid/sơ đồ kiến trúc tĩnh làm ở Phase 7; screenshot/video của deployment thật để Phase 9.

### 7.6. Local/static gate — bắt buộc để đạt CODE READY

- Backend/frontend typecheck, build và lint liên quan pass bằng script đã có.
- Docker image backend build và start local; image chạy non-root, có `swagger.yaml`, ghi được temp upload và không chứa `.env`/secret/source không cần runtime.
- `docker-compose.yml` chỉ bind Redis loopback; Compose config hợp lệ và Redis healthcheck pass.
- Frontend production build pass với một syntactically valid placeholder API URL, không chứa credential và không được mô tả là URL deploy thật. Có thể dùng reserved domain nếu validation hiện tại chấp nhận.
- Source review xác nhận timeout/network/`502`/`503` không clear auth; health-ready transition refetch state cần thiết.
- `render.yaml` validate được; secret dùng `sync: false`, không có root directory sai và không override Docker `CMD` vô cớ.
- Env/docs dùng nhất quán custom-domain contract nhưng source vẫn nhận URL từ environment; không có DNS target giả hoặc tuyên bố domain đã verify.
- README/env/deploy guide đủ để Phase 8 chỉ nhập giá trị thật và thao tác dashboard.
- Không có process-role, Redis realtime emitter, keep-alive service hoặc dependency chưa dùng.

Nếu thiếu Docker daemon, Docker gate là `NOT VERIFIED — Docker daemon required` và Phase 7 chưa được APPROVE hoàn toàn; không biến static review Dockerfile thành bằng chứng image chạy được.

**Rollback**

- Docker/config/docs rollback theo commit độc lập; không ảnh hưởng managed service vì Phase 7 chưa tạo chúng.
- Render native Node chỉ là fallback khi Docker có blocker đã xác minh: build `npm ci && npm run build`, start `npm run start:prod`, health/env contract không đổi.

---

## Phase 8 — Managed deployment và production smoke

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Tạo managed services, nhập secret, deploy hai repository và chứng minh P0 chạy trên Internet. Đây là phase dashboard/runtime chính; kết quả là **DEMO VERIFIED**.

**Phụ thuộc**

- Phase 7 đã đạt CODE READY, bao gồm Docker image build/start local.
- Chủ dự án có hoặc tạo tài khoản Render, Vercel, MongoDB Atlas, Redis Cloud và Cloudinary demo.
- Chủ dự án có quyền quản lý DNS zone `cacbonat.top` để tạo record cho `x.cacbonat.top` và `api.x.cacbonat.top`.

### 8.1. Provider setup và dữ liệu cần xác minh tại ngày deploy

- MongoDB Atlas: tạo demo database/user riêng, cấu hình network access tối thiểu khả dụng và xác minh `withTransaction()` chạy thật.
- Redis Cloud: chọn region gần Render, protocol/version/eviction phù hợp BullMQ và lấy URI từ Connect wizard; xác minh TLS/persistence/HA/backup, memory, connection và ops quota từ dashboard tại thời điểm deploy.
- Render: Free Web Service hỗ trợ Docker/WebSocket/long-running process, một instance và ephemeral filesystem; kiểm tra lại sleep/cold-start/quota hiện hành.
- Vercel: dùng Hobby chỉ khi portfolio đáp ứng điều kiện personal/non-commercial hiện hành.
- Cloudinary: credential riêng cho demo nếu provider cho phép; không cấu hình email provider.
- Domain: xác minh quyền chỉnh DNS của `cacbonat.top`; record type/target, verification state và HTTPS certificate phải lấy từ dashboard Vercel/Render tại ngày deploy, không dùng giá trị ví dụ như constant.

Không sao chép quota cũ từ kế hoạch thành fact. Ghi provider, region, tier, limitation và ngày xác minh; nếu dashboard khác tài liệu thì dashboard hiện tại là evidence cho deployment này.

### 8.2. Thứ tự deploy

1. Chuẩn bị MongoDB Atlas và Redis Cloud; kiểm tra transaction/ping mà không log URI/password.
2. Tạo Render Blueprint/Web Service từ backend repository. Root directory để trống/repo root; dùng `render.yaml`, `./Dockerfile`, `/health/ready`, region đã chọn và một instance.
3. Nhập secret vào Render secret manager: MongoDB, Redis, Cloudinary, JWT, CORS tạm thời và các value `sync: false`; không truyền secret bằng build arg.
4. Deploy backend với preset `memory + inline + cache off`; xác nhận bind `0.0.0.0:$PORT` và toàn bộ API/worker chạy trong `start:prod`.
5. Trên domain `.onrender.com` do provider cấp, kiểm tra `/health/live`, `/health/ready`, `/api-docs` và log startup không lộ secret.
6. Add `api.x.cacbonat.top` vào Render service, tạo đúng DNS record/target mà Render dashboard yêu cầu và chờ provider verify domain + cấp HTTPS.
7. Xác nhận `https://api.x.cacbonat.top/health/live`, `/health/ready` và `/api-docs` hoạt động trước khi build frontend production.
8. Tạo Vercel project từ frontend repository. Root directory để trống/repo root; đặt `NEXT_PUBLIC_API_URL=https://api.x.cacbonat.top/api` trước build rồi deploy.
9. Trên domain `.vercel.app` do provider cấp, xác nhận frontend production load được và request API không bị build-time misconfiguration.
10. Add `x.cacbonat.top` vào Vercel project, tạo đúng DNS record/target mà Vercel dashboard yêu cầu và chờ provider verify domain + cấp HTTPS.
11. Mở `https://x.cacbonat.top` và xác nhận thanh địa chỉ không đổi sang `.vercel.app`; không yêu cầu vô hiệu hóa domain mặc định của Vercel/Render.
12. Cập nhật Render `CORS_ORIGIN=https://x.cacbonat.top`, restart/redeploy backend một lần và xác nhận credentialed request không bị CORS chặn.
13. Xác nhận frontend production gọi HTTP API và Socket.IO qua `https://api.x.cacbonat.top`, không dùng `.onrender.com` trong production config và không có mixed-content HTTP.
14. Mở hai browser profile/private window tại `https://x.cacbonat.top` và bắt đầu P0 smoke.

### 8.3. Account matrix

```text
A: chủ tweet, admin group
B: follower, direct-message partner, group member
C: user được add/remove/block để kiểm tra quyền và lifecycle
```

Tạo account bằng self-registration; không dùng dữ liệu cá nhân thật hoặc credential tái sử dụng ở nơi khác.

### 8.4. P0 smoke — bắt buộc trước khi public

Mọi P0 được chạy từ `https://x.cacbonat.top`; Network/Socket evidence phải cho thấy backend target là `https://api.x.cacbonat.top`. Mỗi nhóm chỉ cần một happy path và một kiểm tra lỗi quan trọng; ghi pass/fail note, không mở rộng thành full regression suite.

**Auth**

- Register auto-verified, login ngay, logout rồi login lại; không phụ thuộc email.
- Sai password hiển thị lỗi phù hợp; timeout/network/`502`/`503` không logout nhầm và log không chứa raw token.

**Tweet/social**

- A tạo tweet text/ảnh; B like, reply và repost; count/UI và notification đại diện của A đúng.
- Follow/unfollow; A block B thì B không gửi được direct message, unblock cho phép gửi mới.

**Chat/realtime**

- A/B tạo direct, gửi text realtime trên hai browser; reply/reaction và unread badge chạy.
- A tạo group với B/C, gửi một message realtime; reload vẫn thấy conversation/message.

**Notification/unread**

- Social và directed-message notification đến đúng recipient.
- Mark-one/read-all cập nhật notification badge; mở conversation cập nhật inbox unread badge.

**Media**

- Upload image, audio và video; URL Cloudinary load lại sau backend restart.
- File sai MIME/quá giới hạn bị từ chối; upload fail không tạo metadata `ready` thiếu durable URL.

**Cold start/restart**

- Dùng restart hợp lệ hoặc chờ sleep nếu provider áp dụng; UI hiển thị trạng thái khởi động/retry và không logout nhầm.
- Socket reconnect, notification state và conversation unread được refetch sau backend ready.
- Ghi thời gian cold start quan sát thật và ngày đo; không hứa con số cố định.

### 8.5. Provider sanity và P1 optional

**Provider sanity bắt buộc**

- Redis dùng eviction/protocol đã chốt và không chứa full message payload/token/credential trong keyspace.
- Connection, memory và ops/sec còn buffer hợp lý; nếu gần trần thì giảm worker/cache/retention trước public release.
- `REDIS_URL` không xuất hiện trong source, build/runtime log, screenshot hoặc README; Docker build context không chứa `.env`.
- Kiểm tra quota Cloudinary, Redis, MongoDB, Render và Vercel sau P0 smoke; ghi limitation có ảnh hưởng cho Phase 9.

**P1 nếu còn thời gian, không chặn release**

- Change password/access-token expiry; unlike/undo repost; revoke/delete-for-me.
- Add/remove member, edit group, leave/transfer admin; mute/pin/hide/delete-history/search/shared-media.
- Ngắt mạng một tab để kiểm tra reconciliation. Mất sạch Redis/exactly-once recovery vẫn là hardening ngoài gate portfolio.

### 8.6. Custom-domain gate

- `https://x.cacbonat.top` resolve qua HTTPS và phục vụ đúng frontend production; browser không redirect sang `.vercel.app`.
- `https://api.x.cacbonat.top/health/live`, `/health/ready` và `/api-docs` hoạt động qua HTTPS.
- Frontend production dùng `NEXT_PUBLIC_API_URL=https://api.x.cacbonat.top/api`; API và Socket.IO không phụ thuộc `.onrender.com` trong production config.
- Backend dùng exact `CORS_ORIGIN=https://x.cacbonat.top`; credentialed request pass và không dùng wildcard.
- Không có mixed-content, certificate error hoặc DNS record chưa verify. P0 smoke đã được chạy qua custom domain.
- Domain mặc định `.vercel.app`/`.onrender.com` có thể hoạt động song song nhưng không được quảng bá làm URL portfolio chính.

Gate cần DNS propagation/provider certificate nhưng chưa có evidence phải ghi `NOT VERIFIED`, không suy ra PASS chỉ từ config hoặc DNS record đã nhập.

### 8.7. Minimal remediation loop

Phase 8 ưu tiên dashboard, deployment và runtime verification. Nếu evidence thật phát hiện lỗi code/config trực tiếp chặn deploy hoặc P0:

1. Ghi failed case và bằng chứng cụ thể.
2. AI được sửa tối thiểu đúng blocker, không refactor hoặc mở rộng technical debt.
3. Chạy lại build/lint/static gate liên quan trực tiếp.
4. Redeploy component bị ảnh hưởng và chỉ xác minh lại failed case cùng smoke phụ thuộc trực tiếp.
5. Review remediation diff trước khi tiếp tục gate Phase 8.

Không dùng remediation loop để kéo Phase 9 polish, P1 hoặc kiến trúc tương lai vào Phase 8.

**Gate hoàn thành**

- Backend/frontend deployment thành công từ đúng repository root; health/live/docs và CORS hoạt động trên URL thật.
- Custom-domain gate pass cho `x.cacbonat.top` và `api.x.cacbonat.top`; production API/Socket.IO traffic dùng backend custom domain.
- Tất cả P0 có pass/fail note; không còn blocker khiến interviewer không register/login hoặc không dùng được tweet/chat/realtime/media đại diện.
- Cold-start/restart không logout nhầm và phục hồi socket/read state đúng ở mức smoke.
- Redis/MongoDB/provider metrics còn trong quota với buffer hợp lý; secret không xuất hiện trong source/log/evidence.
- Minimal remediation, nếu có, đã được review, redeploy và xác minh lại.
- Screenshot/video portfolio không phải gate Phase 8; evidence trình bày được hoàn thiện ở Phase 9.

**Rollback**

- Frontend rollback deployment trước; backend rollback image/commit trước với env contract tương thích.
- Có thể tắt notification handler bằng feature flag; không xóa MongoDB/Redis demo tùy tiện.
- Nếu remediation fail, quay lại deployment cuối pass và giữ failed case rõ ràng thay vì sửa tiếp ngoài scope.

---

## Phase 9 — Portfolio handoff

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Chuyển deployment đã verify thành portfolio public dễ hiểu trong vài phút. Phase này chỉ điền fact/evidence thật và polish handoff; không là một phase kỹ thuật lớn. Kết quả là **PUBLIC READY**.

**Phụ thuộc**

- Phase 8 đạt DEMO VERIFIED, có URL, pass/fail note và provider measurement thật.

### 9.1. URL và measured limitations

- Dùng các URL canonical đã verify ở Phase 8 làm URL chính trong README/portfolio:
  - Demo: `https://x.cacbonat.top`
  - Backend: `https://api.x.cacbonat.top`
  - API docs: `https://api.x.cacbonat.top/api-docs`
  - Health: `https://api.x.cacbonat.top/health/live`
- Không giữ placeholder Phase 7 và không đưa `.vercel.app`/`.onrender.com` lên vị trí URL public chính, dù provider domain vẫn có thể tồn tại làm fallback.
- Ghi cold-start quan sát, ngày đo, region/tier và quota/limitation thực tế đã xác minh ở Phase 8.
- Known limitations phải khớp deployment: single backend instance, free-tier sleep, Redis transport/persistence/HA/TLS thực tế, không email recovery, token storage debt, media limits và UI capability còn thiếu.
- Không công khai URI, secret, database username, dashboard identifier nhạy cảm hoặc log chứa credential.

### 9.2. Demo access bằng self-registration

- Release này dùng self-registration, không thêm `demo:seed` hoặc public disposable password.
- Test registration/login ngay trước khi gửi link; ghi rõ account được kích hoạt ngay, không gửi email verification và không có password recovery qua email.
- Account evidence không dùng email/tên thật; nếu interviewer cần dữ liệu sẵn, hướng dẫn tạo A/B/C bằng registration thay vì hard-code credential.

### 9.3. README finalization

README structure, architecture, setup và deploy guide đã được hoàn thành ở Phase 7. Phase 9 chỉ:

- thay placeholder bằng URL/fact thật;
- dùng `https://x.cacbonat.top` làm demo link canonical và mọi API/docs link public dùng `https://api.x.cacbonat.top`;
- thêm screenshot/GIF ngắn và feature highlights cuối;
- liên kết frontend ↔ backend README/API docs;
- cập nhật smoke result, rollback và limitation theo Phase 8;
- kiểm tra metadata browser không còn `Create Next App`;
- giữ cách gọi “portfolio deployment”/“production-like demo”, không tự nhận production-ready.

Không audit lại toàn repository hoặc viết lại architecture nếu Phase 8 không tạo remediation làm thay đổi contract.

### 9.4. Portfolio evidence và release checklist

- Video 2–4 phút quay từ `https://x.cacbonat.top`: self-registration/login, tweet, hai cửa sổ chat realtime, notification badge và media.
- Một screenshot kiến trúc và một screenshot API docs/health; có thể tái sử dụng Mermaid đã tạo ở Phase 7.
- Ghi ngắn phần khó tự thiết kế: transactional outbox, idempotent message, aggregation, unread source of truth và free-tier Redis trade-off.
- Không đưa secret, dashboard URI hoặc email định danh thật vào ảnh/video.
- Chốt commit/deployment id, env key thay đổi, smoke result và rollback deployment trong release note.

**Gate hoàn thành**

- Người mới mở README có thể vào demo hoặc chạy local mà không hỏi env key bị thiếu.
- Custom domain demo/backend/API docs hoạt động qua HTTPS và self-registration đã được test ngay trước khi chia sẻ.
- Screenshot/video không lộ secret; known limitations khớp code và measurement thật.
- Không còn placeholder giả, `Create Next App` metadata hoặc tuyên bố production-ready thiếu evidence.
- Phase 9 không chứa runtime refactor; blocker runtime mới phải quay lại remediation có scope/evidence rõ.

**Rollback**

- README/evidence rollback không thay runtime; không xóa known limitation chỉ để trình bày đẹp hơn.
- Có thể tạm gỡ public URL/evidence nếu deployment không còn pass; không thay bằng credential hoặc URL giả.

---

## 6. Dependency giữa các phase

```text
Baseline
  → Phase 1 secret/env
  → Phase 2 lint/script truth
  → Phase 3 dependencies
  → Phase 4 env/font/build
  → Phase 5 health/proxy
  → Phase 6 Redis/media upgrade-ready, realtime in-process
  → Phase 7 repository release preparation → CODE READY
  → Phase 8 managed deployment + production smoke → DEMO VERIFIED
  → Phase 9 portfolio handoff → PUBLIC READY
```

- Phase 2 và Phase 3 không chạy song song vì cần lint làm gate cho dependency update.
- Phase 5 phải xong trước deploy để health probe không tạo restart loop.
- Phase 6 phải xong trước video smoke; deploy portfolio dùng inline nhưng queue mode local cũng phải chứng minh durable source/reconciliation, không chấp nhận job local filepath trên host có ephemeral disk.
- Phase 7 hoàn thành code/artifact/docs có thể biết trước deployment; Docker build/start local là gate bắt buộc, còn dashboard/credential/URL thật không thuộc phase này.
- Phase 8 gom provider setup, secret, deploy, runtime measurement và P0 smoke; chỉ cho phép minimal remediation khi evidence thật chứng minh blocker trực tiếp.
- Phase 9 chỉ điền URL/kết quả/evidence thật sau Phase 8; không viết README như thể demo đã deploy trước khi có bằng chứng và không mở runtime refactor mới.

## 7. Release milestone và rollback

1. **Release A — Security/quality:** Phase 1–2. Không đổi hạ tầng; rollback theo repo.
2. **Release B — Dependency/build:** Phase 3–4. Lockfile/font/env contract trong commit riêng.
3. **Release C — Upgrade-ready runtime:** Phase 5–6. Health, Redis/cache mode, in-process realtime seam và durable media pipeline phải đi cùng deploy config tương thích; preset public vẫn là single-instance free-tier.
4. **Release D — Code-ready artifact:** Phase 7. Hai repository, Docker artifact, deploy-as-code, cold-start UX và README skeleton pass local gate.
5. **Release E — Verified portfolio:** Phase 8. Deploy một backend instance/frontend và chạy smoke A/B/C trên managed services.
6. **Release F — Public handoff:** Phase 9. Chỉ public link sau khi self-registration, URL, evidence và README đã kiểm tra.

Mỗi milestone ghi:

- commit/deployment id;
- env key thêm/xóa;
- database/Redis data có bị ảnh hưởng không;
- command build/start;
- smoke result;
- rollback deployment hoặc feature flag.

## 8. Checklist nghiệm thu cuối

### Code và dependency

- [ ] Frontend/backend typecheck, build, lint pass.
- [ ] Backend Prettier check pass.
- [ ] Static notification handoff/relevance pass.
- [ ] Không còn package script tham chiếu file thiếu.
- [ ] Runtime audit không còn high advisory reachable có safe fix; advisory transitive/unreachable hoặc chỉ có breaking migration được ghi rõ.
- [ ] Không còn dependency direct rõ ràng không dùng/nhầm tên.

### Secret và config

- [ ] Không log raw token/JWT/reset link.
- [ ] Email provider/routes/CTA không nằm trong runtime portfolio; register auto-verified và login ngay.
- [ ] `.env.example` đủ và không có secret.
- [ ] MONGODB_URI mode không yêu cầu dummy DB username/password.
- [ ] `CORS_ORIGIN=https://x.cacbonat.top`; frontend dùng `NEXT_PUBLIC_API_URL=https://api.x.cacbonat.top/api` và không chứa backend secret.

### Free-tier runtime

- [ ] Backend host hỗ trợ WebSocket và long-running Node process.
- [ ] MongoDB tier chạy transaction.
- [ ] Version, protocol và TLS của Redis Cloud được xác minh tại ngày deploy; cấu hình thực tế hỗ trợ BullMQ và README mô tả đúng transport đang dùng.
- [ ] Portfolio dùng Socket.IO adapter `memory`; notification delivery đi qua in-process emitter seam và không tuyên bố đã hỗ trợ split-worker realtime.
- [ ] Redis cache/queue/socket URL fallback đúng; connection/memory có số đo và còn buffer dưới quota provider.
- [ ] Queue/cache retention nằm trong quota bộ nhớ đo được của provider và còn buffer; không dùng Redis làm unread/data source duy nhất và không cache full message payload.
- [ ] Redis Cloud dùng region gần Render, eviction/persistence khớp cấu hình đã xác minh và các giới hạn thực tế được ghi trong README.
- [ ] Không có BullMQ payload giữ ephemeral filepath.
- [ ] Media inline deploy pass; media queue local dùng durable Cloudinary reference, deterministic job và missing-job reconciliation pass.
- [ ] Health live/ready tối giản hoạt động, không bị limiter và không lộ config.
- [ ] Cold start/restart khôi phục socket state qua REST và xử lý outbox backlog.
- [ ] Frontend hiển thị trạng thái khởi động demo và không logout nhầm khi Render timeout/`502`/`503`.

### Feature smoke

Các mục dưới đây là P0; edge case P1 trong Phase 8 không chặn public release.

- [ ] `x.cacbonat.top` và `api.x.cacbonat.top` đã verify DNS/HTTPS; API/Socket.IO dùng backend custom domain, không có mixed-content.
- [ ] Register auto-verified/login/logout chạy trên `https://x.cacbonat.top`, không phụ thuộc email.
- [ ] Create/like/reply/repost tweet đúng.
- [ ] Follow/block đúng.
- [ ] Direct/group chat và realtime hai browser đúng.
- [ ] Notification và hai badge unread đúng sau reconnect/reload.
- [ ] Image/video/audio upload và load lại sau restart đúng.

### Portfolio handoff

- [ ] Frontend/backend README khớp code, measurement và dùng `https://x.cacbonat.top`/`https://api.x.cacbonat.top` làm URL canonical.
- [ ] Self-registration đã được kiểm tra ngay trước khi chia sẻ; không có demo credential hard-code/public.
- [ ] Có screenshot/video ngắn không lộ secret.
- [ ] Docker image backend chạy non-root, chứa `swagger.yaml`, không chứa secret; Compose Redis chỉ dùng local/loopback.
- [ ] Known limitations ghi free-tier sleep, Redis TLS/HA/persistence/backup theo evidence thực tế Phase 8, single instance, không email recovery, auth token technical debt và feature UI chưa nối.
- [ ] Không dùng từ “production-ready” nếu chưa có load/fault/multi-instance/migration evidence.

### Phần chủ dự án tự thực hiện

- [ ] CI build/lint/static audit trên push.
- [ ] Integration test Login/refresh token.
- [ ] Integration test outsider không đọc conversation.
- [ ] Integration test message retry không duplicate.
- [ ] Integration test notification unread/read.
- [ ] Integration test block ngăn direct message.

Các checkbox user-owned không được agent tự đánh dấu chỉ dựa trên static audit; chủ dự án cập nhật sau khi thực sự hoàn thành.
