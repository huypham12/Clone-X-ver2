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
- Tách API, notification worker và fan-out worker thành nhiều service trả phí.
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

| Thành phần | Lựa chọn mặc định           | Quyết định triển khai                                                                                                                                                   |
| ---------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | Vercel Hobby                | Root `X-frontend`, deploy Next.js native; chỉ dùng cho portfolio cá nhân/non-commercial.                                                                                |
| Backend    | Render Free Web Service     | Root `X-ver2`, một instance hỗ trợ HTTP + WebSocket; chấp nhận sleep/cold start.                                                                                        |
| Database   | MongoDB Atlas Free          | Database demo riêng; phải chạy thử transaction thật trước deploy vì code dùng `withTransaction()`.                                                                      |
| Redis      | Redis Cloud Essentials Free | Redis 8.2, RESP2, 30 MB/30 connection/100 ops/s, `no eviction`; không HA/persistence/backup/TLS nên Mongo outbox là nguồn phục hồi và không cache full message payload. |
| Media      | Cloudinary Free             | Lưu image/video/audio bền; local disk chỉ là temp trong một request.                                                                                                    |
| Email      | Không triển khai            | Không tạo provider/secret; register auto-verified và login ngay.                                                                                                        |

Lý do không cố nhét mọi thứ vào một host: frontend hợp với Vercel, backend realtime cần long-running process/WebSocket, còn MongoDB/Redis/media cần dịch vụ managed riêng. Đây vẫn là một topology không cần VPS.

Tài liệu tham chiếu khi chốt: [Vercel pricing](https://vercel.com/pricing), [Render free services](https://render.com/docs/free), [Render Docker](https://render.com/docs/docker), [Redis Cloud Free plans](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/), [Redis Cloud TLS](https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/), [MongoDB Atlas Free](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/) và [Cloudinary pricing](https://cloudinary.com/pricing).

### 4.2. Một backend instance, worker chạy cùng process

- Chỉ triển khai một long-running Node.js web service có hỗ trợ WebSocket; không triển khai backend vào serverless function thuần request/response.
- Notification worker, fan-out worker và outbox publisher tiếp tục chạy cùng API process để không cần thêm service trả phí.
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

### 4.4. Hai mode Socket.IO adapter

Thêm cấu hình:

```text
SOCKET_REDIS_ADAPTER_ENABLED=false   # portfolio single-instance
```

- `false`: chỉ dùng in-memory Socket.IO adapter. `io.in(userId).allSockets()` vẫn đúng trong một process và không mở hai connection Redis pub/sub.
- `true`: mở `pubClient`/`subClient` và Redis adapter khi sau này thật sự chạy nhiều backend instance.
- Cache Redis và BullMQ vẫn hoạt động khi adapter Socket.IO tắt.
- Không tự động bật adapter chỉ vì có `REDIS_URL`; mục đích của biến phải rõ ràng.

Budget connection mục tiêu ở mode portfolio:

```text
1 node-redis cache/presence
1 ioredis base dùng cho Queue/publisher
+ connection nội bộ bắt buộc của từng BullMQ Worker đang bật
0 Socket.IO pub/sub connection khi single-instance
```

Không hard-code tổng cuối cùng dựa trên giả định thư viện. Phase Redis phải đo số connection thật trên dashboard/provider hoặc `CLIENT LIST` nếu provider cho phép, rồi ghi con số vào README vận hành.

### 4.5. Redis không là nguồn sự thật

| Dữ liệu                    | Nguồn sự thật                   | Redis mất/flush thì sao                                                |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| Notification/outbox        | MongoDB                         | Publisher có thể enqueue lại theo event id                             |
| Notification unread        | MongoDB `NotificationState`     | REST trả lại state                                                     |
| Conversation unread        | MongoDB read-state              | REST reconcile lại badge                                               |
| Message/conversation cache | MongoDB                         | Cache miss và hydrate lại                                              |
| Presence/last seen         | Redis, best-effort              | Có thể mất trạng thái tạm thời                                         |
| BullMQ job                 | Redis + event id/outbox MongoDB | Notification có thể redeliver từ outbox; không được `FLUSHDB` tùy tiện |

Không dùng Redis free-tier để giữ dữ liệu duy nhất không thể tái tạo.

### 4.6. Video upload không đưa local filepath vào durable queue

Chọn phương án phù hợp portfolio, ít hạ tầng nhất:

1. Video được nhận vào file tạm với giới hạn dung lượng bảo thủ, mặc định 20 MB và có thể cấu hình.
2. Request upload ngay file đó lên Cloudinary trước khi trả response.
3. Chỉ ghi `MediaMetadata.status=ready` sau khi Cloudinary trả `secure_url/public_id`.
4. File tạm luôn bị xóa trong `finally`, kể cả DB/Cloudinary lỗi.
5. Không enqueue job chứa `filepath`; video worker local hiện tại được bỏ khỏi startup hoặc giữ ngoài runtime nhưng không còn production caller.

Trade-off được chấp nhận: request video lâu hơn và dung lượng demo nhỏ hơn, đổi lại restart/sleep không tạo job mồ côi. Direct-to-Cloudinary signed upload hoặc durable source staging là hướng production tương lai, ngoài phạm vi portfolio này.

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

**Trạng thái: Đã triển khai ngày 2026-08-11.**

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

**Trạng thái: Chưa triển khai.**

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
- Cập nhật metadata title/description/Open Graph cơ bản từ `Create Next App` thành X Clone portfolio.
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
SOCKET_REDIS_ADAPTER_ENABLED

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

**Gate hoàn thành**

- Copy `.env.example` thành env local, điền đúng các secret bắt buộc là đủ start app.
- `git grep` không tìm thấy secret/value từ `.env` thật trong tracked files.
- Frontend offline build và backend build pass.

**Rollback**

- Font local có thể rollback sang system font stack; không rollback về build bắt buộc gọi Google Fonts.

---

## Phase 5 — Health/readiness và hành vi đúng sau reverse proxy

**Trạng thái: Chưa triển khai.**

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

## Phase 6 — Tối ưu Redis/BullMQ và media cho free-tier

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Giảm connection/memory, chịu được cold start và loại job media phụ thuộc disk tạm.

**Phụ thuộc**

- Phase 5 cung cấp health state.
- Redis Cloud Free đã được tạo; region, version, RESP, eviction, connection/memory/ops quota và giới hạn không TLS/persistence được ghi lại.

### 6.1. Lazy Redis clients theo capability

**File sửa**

- `src/config/redis.service.ts`:
  - luôn tạo/connect cache client;
  - chỉ duplicate/connect pub/sub khi `SOCKET_REDIS_ADAPTER_ENABLED=true`;
  - getter adapter trả trạng thái/type an toàn, không giả định client luôn tồn tại;
  - shutdown chỉ đóng client đã tạo.
- `src/socket/index.ts`:
  - chỉ gắn Redis adapter khi flag bật và clients ready;
  - mode false log một dòng rõ `single-instance in-memory adapter`;
  - presence dùng default adapter trong process, không đổi frontend contract.
- `src/config/getEnvConfig.ts`: parse flag strict boolean.
- Thêm `CONVERSATION_MESSAGE_CACHE_ENABLED=false` cho portfolio Redis Cloud Free; khi false, không `zAdd` full hydrated message vào Redis và read path lấy từ MongoDB. Chỉ cân nhắc bật lại khi Redis transport có TLS.

### 6.2. Retention và tối thiểu hóa dữ liệu Redis

- Dùng Redis Cloud database riêng cho demo và Redis container riêng cho local; không thêm key-prefix migration xuyên toàn bộ cache/queue trong release này.
- Không gọi `KEYS *`, `FLUSHALL` hoặc `FLUSHDB` trong runtime/script deploy.
- Giảm BullMQ retention phù hợp quota portfolio:
  - completed mặc định tối đa khoảng 300 job/1 giờ cho mỗi queue;
  - failed mặc định tối đa khoảng 500 job/7 ngày cho mỗi queue, thay cho 50.000/30 ngày;
  - dead-letter nghiệp vụ tiếp tục có Mongo outbox làm nguồn audit.
- Không cache full message payload trên Redis Cloud Free không TLS. Cache friend/presence chỉ chứa ID/timestamp, có TTL rõ; key không TTL phải có lý do và kích thước bị chặn.
- Ghi vai trò queue/cache vào README nhưng không ghi URL Redis.

### 6.3. Video upload

**File sửa**

- `src/modules/media/media.controller.ts`: upload video Cloudinary đồng bộ, chỉ insert/update ready metadata khi durable URL tồn tại.
- `src/utils/file.ts`: giới hạn dung lượng từ env với default portfolio bảo thủ; validate MIME/field; cleanup file tạm trong mọi nhánh.
- `src/utils/cloudinary.ts`: cleanup bằng async-safe `finally`, không để unlink lỗi che lỗi upload chính.
- `src/queues/video.queue.ts`: bỏ production worker/caller hoặc chuyển thành module không còn được app start; ưu tiên xóa code chết nếu không còn consumer.
- `src/app.ts`: không start/close video worker khi flow đồng bộ đã chốt.
- `package.json`/README/endpoint docs nếu response video chuyển từ pending sang ready ngay.

### 6.4. Deploy sanity check

Kịch bản bắt buộc, giới hạn ở hành vi thường gặp của bản demo:

1. Backend khởi động và cả `node-redis`/BullMQ kết nối được bằng Redis Cloud URI.
2. Chat realtime và notification chạy sau deploy.
3. Restart backend bình thường: clients reconnect, frontend refetch state và outbox pending tiếp tục được xử lý ở mức smoke test.
4. Upload video rồi restart backend: media đã có durable Cloudinary URL hoặc request đã fail rõ; không có pending job trỏ tới file local đã mất.

Diễn tập mất sạch Redis và chứng minh exactly-once recovery là **document only**, không phải release gate portfolio. MongoDB vẫn là nguồn dữ liệu nghiệp vụ; README phải nêu Redis Cloud Free không có persistence và có thể mất queue/cache/presence khi provider reset.

**Gate hoàn thành**

- Mode single-instance không mở Socket pub/sub Redis connections.
- Số connection và memory quan sát trên dashboard còn dưới quota provider, có buffer hợp lý; không dùng ngưỡng tự đặt làm blocker nếu hệ thống ổn định.
- Cả `node-redis` và `ioredis` kết nối bằng URI do Redis Cloud cung cấp; free tier dùng `redis://`, không log URI/password.
- Full hydrated message không xuất hiện trong Redis keyspace khi `CONVERSATION_MESSAGE_CACHE_ENABLED=false`.
- Không có queue payload production chứa absolute/local `filepath`.
- Image/video/audio upload đều pass và không để file temp sau success/failure.

**Rollback**

- Có thể bật lại Redis Socket adapter bằng flag khi chuyển sang nhiều instance.
- Video sync rollback chỉ được phép nếu thay bằng durable source staging; không rollback về job giữ ephemeral filepath trên môi trường deploy.

---

## Phase 7 — Đóng gói và cấu hình Vercel/Render

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Hai repository deploy được trên stack đã chốt, không phụ thuộc thao tác bí mật ngoài tài liệu và có UX hợp lý khi Render cold start.

**Phụ thuộc**

- Phase 3–6.

### 7.1. Backend artifact

**File tạo/sửa đề xuất**

- `Dockerfile`: multi-stage trên Node 22 Debian slim; build stage chạy `npm ci` + compile `dist`, runtime chỉ cài production dependency, chạy user non-root.
- Runtime image phải copy `dist`, `package*.json` và `swagger.yaml`; không copy `.env`, source, test hoặc tài liệu kế hoạch.
- Tạo/chown `uploads/images/temp`, `uploads/videos`, `uploads/audios` để user non-root ghi được trong thời gian request; các thư mục này vẫn là ephemeral.
- `CMD ["npm", "run", "start:prod"]`; không override Docker Command trên Render nếu không có lý do.
- `.dockerignore`: bỏ `.git`, `node_modules`, `dist`, `.env*` (ngoại trừ example không cần copy vào runtime), uploads local, log, test output và tài liệu không cần runtime.
- `package.json`: Node engine, build/start command rõ; không dùng nodemon production.
- Bảo đảm `swagger.yaml` được copy hoặc API docs có feature flag, tránh startup fail vì working directory khác.

Container/runtime phải có writable temp directory nhỏ cho multipart trong thời gian request; không coi đây là persistent volume.

### 7.2. Docker Compose chỉ dành cho local

- `docker-compose.yml` hiện chỉ là local Redis helper, không deploy file này lên Render và không chạy Redis container production song song với Redis Cloud.
- Bỏ trường Compose `version` cũ; dùng image Redis 8.2 Alpine để gần Redis Cloud 8.2.
- Bind port `127.0.0.1:6379:6379`, không expose Redis local ra LAN/Internet.
- Local Redis bật AOF `appendonly yes`, `appendfsync everysec`, volume riêng và `maxmemory-policy noeviction` để hành vi queue gần production.
- Có healthcheck `redis-cli ping`; backend local dùng `REDIS_URL=redis://localhost:6379`.
- Có thể thêm backend service/profile để smoke Docker image, nhưng Redis service local phải tiếp tục dùng được độc lập cho workflow `npm run dev`.

### 7.3. Frontend artifact

- Dùng Vercel Hobby cho portfolio cá nhân/non-commercial và native Next.js deployment.
- Project root phải là `X-frontend`; build `npm ci && npm run build`.
- Production env `NEXT_PUBLIC_API_URL=https://<backend-domain>/api` phải có trước build vì đây là public build-time variable.
- Không đặt backend secret trong bất kỳ `NEXT_PUBLIC_*` variable nào.

### 7.4. Backend managed service settings

```text
Root directory: X-ver2
Language/runtime: Docker
Dockerfile path: ./Dockerfile
Docker command: để trống, dùng CMD trong image
Health: /health/ready
Instance count: 1
Region: Singapore
```

- Dùng Render Free Web Service; server phải bind `0.0.0.0` và đọc port từ `process.env.PORT`, không hard-code port production.
- Render phải hỗ trợ WebSocket và long-running process; không chuyển backend này thành Vercel/serverless functions.
- `CORS_ORIGIN` là exact frontend origin, nhiều origin phân cách theo contract hiện tại; không dùng `*` cùng credentials.
- MongoDB network access chỉ mở theo khả năng platform; credential là user riêng cho demo database.
- Redis Cloud đặt AWS Singapore nếu Render ở Singapore; đây vẫn là public TCP endpoint, không phải Render private network.
- `REDIS_URL` dùng đúng URI Redis Cloud Connect wizard, chỉ nằm trong Render secret manager. Free tier không TLS nên scheme là `redis://`; README phải ghi đây là portfolio limitation.
- Không truyền secret bằng Docker build arg, không bake `.env` vào image và không in Redis URI trong build/runtime log.
- Cloudinary dùng credential riêng cho demo nếu provider cho phép; không cấu hình email provider.
- Feature flags notification được ghi rõ, không dựa vào default ngầm trong dashboard.

### 7.5. Frontend UX khi Render cold start

Render Free có thể spin down sau thời gian không có inbound HTTP/WebSocket và request đánh thức có thể mất khoảng một phút. Frontend phải phân biệt cold start/network error với hết phiên đăng nhập:

- Thêm trạng thái `Đang khởi động máy chủ demo…` khi health/API đầu tiên chưa phản hồi; không hiện toast lỗi chung lặp lại.
- Retry `/health/live` hoặc request bootstrap với backoff có giới hạn trong khoảng thời gian được đo thực tế; có nút thử lại thay vì treo vô hạn.
- Chỉ xóa session khi refresh/login endpoint trả `401` xác thực rõ ràng. Timeout, network error, `502` hoặc `503` trong lúc backend thức dậy không được tự logout user.
- Socket giữ cơ chế reconnect; sau khi backend ready phải refetch notification state và conversation unread summary.
- Không dùng keep-alive/ping bên thứ ba để lách chính sách free-tier.

**File frontend trọng điểm**

- `src/features/auth/components/auth-initializer.tsx` hoặc bootstrap auth tương đương.
- API client/interceptor xử lý refresh và lỗi network.
- Socket provider/reconnect hook.
- Component trạng thái demo-server dùng ở màn hình khởi tạo.

### 7.6. Free-tier limitation checklist trước khi tạo service

- Có sleep/cold start không, thời gian request đầu khoảng bao lâu.
- Có WebSocket không và idle timeout bao lâu.
- Build/runtime disk/RAM/CPU/request timeout đủ cho Node + Sharp + upload giới hạn đã chốt không.
- Redis Cloud còn buffer dưới 30 connection/30 MB/100 ops/s; eviction là `no eviction`; không TLS/persistence/HA/backup được ghi là limitation.
- MongoDB tier hỗ trợ transaction.
- Outbound HTTPS/TLS tới Cloudinary/MongoDB và outbound TCP tới Redis Cloud được phép.

Không ghi cứng quota theo tên nhà cung cấp trong code; quota thay đổi phải được kiểm tra tại thời điểm tạo service và ghi ngày kiểm tra trong README deploy.

**Gate hoàn thành**

- Docker image backend build/start local được bằng env example đã điền.
- Image chạy non-root, có `swagger.yaml`, ghi được temp upload; `.dockerignore` loại `.env*` và build không truyền secret qua build arg.
- `docker-compose.yml` local chỉ bind Redis vào loopback và healthcheck pass.
- Frontend build với production API URL.
- Health ready `200` sau dependency startup.
- Cold-start UI không xóa auth khi backend tạm timeout/`502`/`503` và chuyển sang app bình thường sau khi health ready.
- Swagger/API docs không làm backend crash vì thiếu file.
- Restart container không làm app phụ thuộc persistent local uploads.

**Rollback**

- Có thể dùng Render native Node làm rollback nếu Docker build gặp blocker; build `npm ci && npm run build`, start `npm run start:prod`, health/env contract không đổi.

---

## Phase 8 — Deploy và manual smoke test các luồng P0 portfolio

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Chứng minh feature thật sự chạy xuyên frontend, backend và managed services; không chỉ build thành công.

**Phụ thuộc**

- Phase 7.
- Chủ dự án đã tạo Vercel project, Render Web Service, Redis Cloud Free, MongoDB Atlas database và Cloudinary account demo.

### 8.1. Thứ tự deploy

1. Tạo MongoDB Atlas Free database demo mới, xác minh `withTransaction()` hoạt động thật.
2. Hoàn thiện Redis Cloud: tên `clone-x-portfolio`, Redis 8.2, RESP2, `no eviction`, AWS Singapore nếu Render Singapore; xác nhận no HA/persistence/backup/TLS là giới hạn free.
3. Nếu database hiện được tạo ở Virginia và vẫn 0 key/0 connection, tạo lại ở Singapore trước khi đưa credential/dữ liệu vào. Region không đổi tại chỗ được.
4. Lấy URI từ Connect wizard, lưu `REDIS_URL` trong Render secret manager; xác minh `node-redis` và `ioredis` cùng ping được mà không log URI/password.
5. Deploy Render backend bằng Docker, xác nhận bind `0.0.0.0:$PORT`, với frontend origin tạm thời hoặc origin dự kiến.
6. Kiểm tra `/health/live`, `/health/ready`, `/api-docs` nếu bật.
7. Deploy frontend trên Vercel với backend URL chính xác.
8. Cập nhật `CORS_ORIGIN` theo frontend URL cuối và restart backend một lần.
9. Mở hai browser profile/private window để test realtime A/B.

### 8.2. Account matrix

```text
A: chủ tweet, admin group
B: follower, direct-message partner, group member
C: user được add/remove/block để kiểm tra quyền và lifecycle
```

Không tái sử dụng account chứa thông tin cá nhân thật.

### 8.3. P0 smoke — bắt buộc trước khi public

Mỗi nhóm chỉ cần một happy path và một kiểm tra lỗi quan trọng; không mở rộng thành full regression suite.

**Auth**

- Register account mới, auto-verified và login ngay, không cần email; logout rồi login lại thành công.
- UI không còn CTA verify/forgot/reset email. Sai password hiển thị lỗi phù hợp; log không chứa raw token.

**Tweet/social**

- A tạo tweet text/ảnh; B lần lượt like, reply và repost; count/UI và notification của A đúng ở mức smoke.
- Follow/unfollow chạy; sau khi A block B, B không gửi được direct message. Unblock khôi phục khả năng gửi mới.

**Chat/realtime**

- A và B tạo direct, gửi text và thấy message realtime trên hai browser; reply/reaction và unread badge chạy.
- A tạo group với B/C và gửi một message realtime; reload vẫn thấy conversation/message.

**Notification/unread**

- Notification đại diện từ social và direct message đến đúng recipient.
- Mark-one hoặc read-all cập nhật notification badge; mở conversation cập nhật inbox unread badge.

**Media**

- Upload ít nhất một image, một audio và một video; URL Cloudinary load lại được sau backend restart.
- File sai MIME hoặc quá giới hạn bị từ chối rõ; upload fail không để metadata ready thiếu URL.

**Cold start/restart**

- Dùng restart hợp lệ hoặc chờ service sleep nếu provider áp dụng; UI hiển thị trạng thái khởi động và retry, không logout nhầm vì `502`/`503` tạm thời.
- Socket reconnect và notification/conversation refetch sau backend hoạt động lại.
- README ghi thời gian cold start quan sát thực tế và ngày đo, không hứa con số cố định.

### 8.4. P1 smoke — nếu còn thời gian, không chặn release

- Change password và access-token refresh/expiry edge case.
- Unlike/undo repost, revoke/delete-for-me và semantics notification chi tiết.
- Add/remove member, edit group, leave/transfer admin và quyền của member bị remove.
- Mute/pin/hide/delete-history/search/shared-media.
- Ngắt mạng một tab rồi kiểm tra reconciliation toàn bộ event bị lỡ.
- Restart đúng thời điểm outbox pending để quan sát duplicate; diễn tập mất sạch Redis/exactly-once recovery chỉ là hardening sau portfolio release.

### 8.5. Provider sanity check

- Redis dashboard dùng `no eviction`, RESP2 và không có full message payload/token/credential trong keyspace.
- Connection, memory và ops/sec còn dưới quota provider với buffer hợp lý; nếu gần trần thì giảm worker/cache/retention trước khi public.
- `REDIS_URL` không xuất hiện trong source, build/runtime log, screenshot hoặc README; Docker build context không chứa `.env`.
- Kiểm tra quota Cloudinary, Redis, MongoDB và Render sau P0 smoke; ghi mọi giới hạn có ảnh hưởng vào README.

**Gate hoàn thành**

- Tất cả P0 case có pass/fail note và bằng chứng screenshot/video ngắn cho luồng chính; P1 không chặn release.
- Không còn blocker khiến interviewer không đăng nhập hoặc không dùng được chat/realtime.
- Redis connection/memory, MongoDB storage và provider log không vượt quota sau smoke.
- Nếu một feature bị giới hạn bởi free-tier, UI/README nói rõ thay vì để timeout im lặng.

**Rollback**

- Frontend rollback về deployment trước.
- Backend rollback image/commit trước với env contract tương thích.
- Có thể tắt từng notification handler bằng feature flag; không xóa MongoDB/Redis production-demo tùy tiện.

---

## Phase 9 — Tài khoản demo, README và portfolio handoff

**Trạng thái: Chưa triển khai.**

**Mục tiêu**

Giúp interviewer hiểu và trải nghiệm dự án trong vài phút mà không cần đọc toàn bộ source.

**Phụ thuộc**

- Phase 8 có URL và smoke result thật.

### 9.1. Demo access

Chọn một trong hai cách và ghi rõ trong README:

1. **Tài khoản demo dựng sẵn — ưu tiên cho phỏng vấn**
   - Tạo bằng script idempotent `demo:seed` hoặc thao tác có tài liệu.
   - Email/password lấy từ env lúc seed, không hard-code vào source.
   - Account không có dữ liệu cá nhân/quyền đặc biệt.
   - Credential công khai được coi là disposable; kiểm tra/reset thủ công trước buổi phỏng vấn.
2. **Self-registration**
   - Đây là fallback đơn giản và phải được test ngay trước khi gửi link.
   - Ghi rõ account được kích hoạt ngay, không gửi email xác minh; password recovery qua email chưa có trong portfolio scope.

Nếu công khai credential trên README, đó phải là credential riêng cho account disposable; tuyệt đối không dùng lại password ở nơi khác.

### 9.2. Frontend README

Thay README Create Next App bằng:

1. Tên dự án, demo URL, screenshot/GIF ngắn.
2. Feature highlights tập trung vào notification/chat thay vì liệt kê chung chung.
3. Tech stack và vai trò từng công nghệ.
4. Sơ đồ kiến trúc frontend ↔ API/Socket ↔ MongoDB/Redis/BullMQ/Cloudinary.
5. Local setup từ `.env.example`.
6. Scripts build/lint/start.
7. Demo account hoặc registration flow.
8. Known limitations: free-tier cold start, Redis free không TLS/HA/persistence/backup, single backend instance, chưa có email verification/password recovery, token storage hiện tại, media size và các UI endpoint còn thiếu.
9. Link backend README/API docs.

### 9.3. Backend README

Bổ sung:

1. Production-like/free-tier topology và yêu cầu WebSocket/long-running process.
2. MongoDB transaction requirement.
3. Redis Cloud 8.2/RESP2, public TCP không TLS trên free tier, `no eviction`, single-instance adapter flag, quota/connection budget, retention và outbox recovery.
4. Docker topology: backend image trên Render; Compose Redis chỉ dành cho local, không phải production datastore.
5. Env matrix required/optional/default.
6. Health endpoints và deploy commands.
7. Notification outbox/idempotency/reconciliation giải thích ngắn.
8. Media persistence và giới hạn demo.
9. Smoke checklist/known limitations/rollback.
10. Auth scope: register auto-verified/login ngay; email verification và password recovery cố ý không deploy.
11. Không tự nhận production-ready; dùng cụm “portfolio deployment” hoặc “production-like demo”.

### 9.4. Portfolio evidence

- Một video 2–4 phút: login, tweet, hai cửa sổ chat realtime, notification badge, media.
- Một screenshot kiến trúc và một screenshot API docs/health.
- Ghi rõ phần khó tự thiết kế: transactional outbox, idempotent message, aggregation, unread source of truth và free-tier Redis trade-off.
- Không đưa log/dashboard có secret hoặc email định danh thật vào ảnh.

**Gate hoàn thành**

- Người mới mở README có thể vào demo hoặc chạy local mà không hỏi env key bị thiếu.
- Metadata browser không còn `Create Next App`.
- Demo credential hoạt động hoặc self-registration đã được test ngay trước khi chia sẻ.
- Known limitations khớp code/deployment thật.

**Rollback**

- Demo account có thể khóa/xóa độc lập mà không ảnh hưởng account thật.
- README rollback không thay runtime; không xóa known limitation chỉ để trình bày đẹp hơn.

---

## 6. Dependency giữa các phase

```text
Baseline
  → Phase 1 secret/env
  → Phase 2 lint/script truth
  → Phase 3 dependencies
  → Phase 4 env/font/build
  → Phase 5 health/proxy
  → Phase 6 Redis/media free-tier
  → Phase 7 packaging/deploy config
  → Phase 8 deploy + smoke
  → Phase 9 demo/README/handoff
```

- Phase 2 và Phase 3 không chạy song song vì cần lint làm gate cho dependency update.
- Phase 5 phải xong trước deploy để health probe không tạo restart loop.
- Phase 6 phải xong trước video smoke; không chấp nhận job local filepath trên host có ephemeral disk.
- Phase 9 chỉ ghi URL/kết quả thật sau Phase 8, không viết README như thể demo đã deploy trước khi có bằng chứng.

## 7. Release milestone và rollback

1. **Release A — Security/quality:** Phase 1–2. Không đổi hạ tầng; rollback theo repo.
2. **Release B — Dependency/build:** Phase 3–4. Lockfile/font/env contract trong commit riêng.
3. **Release C — Free-tier runtime:** Phase 5–6. Health, Redis mode và video persistence phải đi cùng deploy config tương thích.
4. **Release D — Staging portfolio:** Phase 7–8. Deploy một backend instance và chạy smoke A/B/C.
5. **Release E — Public handoff:** Phase 9. Chỉ public link sau khi account/demo/README đã kiểm tra.

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
- [ ] CORS exact origin; frontend không chứa backend secret.

### Free-tier runtime

- [ ] Backend host hỗ trợ WebSocket và long-running Node process.
- [ ] MongoDB tier chạy transaction.
- [ ] Redis Cloud 8.2 dùng RESP2/TCP và hỗ trợ BullMQ; free tier không TLS được ghi rõ, không dùng nhầm `rediss://`.
- [ ] Socket Redis adapter tắt ở single-instance; connection/memory có số đo và còn buffer dưới quota provider.
- [ ] Queue/cache retention nằm trong 30 MB; không dùng Redis làm unread/data source duy nhất và không cache full message payload.
- [ ] Redis Cloud dùng AWS Singapore khi Render Singapore và eviction `no eviction`; giới hạn không persistence được ghi trong README.
- [ ] Không có BullMQ payload giữ ephemeral filepath.
- [ ] Health live/ready tối giản hoạt động, không bị limiter và không lộ config.
- [ ] Cold start/restart khôi phục socket state qua REST và xử lý outbox backlog.
- [ ] Frontend hiển thị trạng thái khởi động demo và không logout nhầm khi Render timeout/`502`/`503`.

### Feature smoke

Các mục dưới đây là P0; edge case P1 trong Phase 8 không chặn public release.

- [ ] Register auto-verified/login/logout chạy trên domain deploy, không phụ thuộc email.
- [ ] Create/like/reply/repost tweet đúng.
- [ ] Follow/block đúng.
- [ ] Direct/group chat và realtime hai browser đúng.
- [ ] Notification và hai badge unread đúng sau reconnect/reload.
- [ ] Image/video/audio upload và load lại sau restart đúng.

### Portfolio handoff

- [ ] Frontend/backend README khớp code và URL thật.
- [ ] Có demo account disposable hoặc self-registration đã kiểm tra.
- [ ] Có screenshot/video ngắn không lộ secret.
- [ ] Docker image backend chạy non-root, chứa `swagger.yaml`, không chứa secret; Compose Redis chỉ dùng local/loopback.
- [ ] Known limitations ghi free-tier sleep, Redis không TLS/HA/persistence/backup, single instance, không email recovery, auth token technical debt và feature UI chưa nối.
- [ ] Không dùng từ “production-ready” nếu chưa có load/fault/multi-instance/migration evidence.

### Phần chủ dự án tự thực hiện

- [ ] CI build/lint/static audit trên push.
- [ ] Integration test Login/refresh token.
- [ ] Integration test outsider không đọc conversation.
- [ ] Integration test message retry không duplicate.
- [ ] Integration test notification unread/read.
- [ ] Integration test block ngăn direct message.

Các checkbox user-owned không được agent tự đánh dấu chỉ dựa trên static audit; chủ dự án cập nhật sau khi thực sự hoàn thành.
