# Portfolio deployment guide

Tài liệu này chuẩn bị Phase 8; Phase 7 không tạo managed service, nhập secret, sửa DNS hoặc tuyên bố public URL hoạt động.

## Trạng thái và domain contract

| Hạng mục | Target | Phase 7 status |
| --- | --- | --- |
| Frontend | `https://x.cacbonat.top` | NOT VERIFIED |
| Backend API/Socket.IO | `https://api.x.cacbonat.top` | NOT VERIFIED |
| Frontend API base | `https://api.x.cacbonat.top/api` | Config contract only |
| Backend CORS | `https://x.cacbonat.top` | Config contract only |
| DNS/HTTPS | Target do provider dashboard cấp | NOT VERIFIED |
| Provider quota/limitations | Ghi theo dashboard ở ngày deploy | NOT VERIFIED |

Backend và frontend là hai Git repository độc lập. Khi import từng repository, Root Directory là `.` hoặc để trống; không đặt `X-ver2` hoặc `X-frontend`.

## 1. Chuẩn bị MongoDB

1. Trong MongoDB Atlas, tạo project/cluster demo riêng ở free tier hiện có tại ngày deploy.
2. Tạo database user riêng và network access tối thiểu khả dụng cho Render.
3. Chọn database name `x_clone` hoặc cập nhật `DB_NAME` nhất quán.
4. Lấy `MONGODB_URI` vào secret manager; không paste URI vào source, build arg, screenshot hoặc log.
5. Trước deploy, chạy một transaction `withTransaction()` an toàn trên database demo và xác nhận commit/abort hoạt động.

Evidence cần ghi: tier, region, MongoDB version, transaction PASS/FAIL, ngày xác minh và error đã redact nếu có. Không gửi URI/user/password.

Tham chiếu: [MongoDB Atlas free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/).

## 2. Chuẩn bị Redis

1. Trong Redis Cloud, tạo database free/portfolio gần region Render nếu dashboard cho phép.
2. Chọn Redis TCP connection tương thích `node-redis`, `ioredis`, Pub/Sub và blocking command của BullMQ; không dùng REST endpoint.
3. Chọn protocol/version tương thích theo dashboard hiện tại; ưu tiên RESP2 cho contract release nếu có lựa chọn.
4. Chọn `no eviction`/`noeviction` nếu provider hỗ trợ để write fail rõ thay vì âm thầm xóa queue key.
5. Copy URI từ Connect wizard vào `REDIS_URL` của Render. Các URL capability không cần set khi dùng chung endpoint.
6. Ping an toàn mà không log URI/password.

Evidence cần ghi: provider/product, tier, region, version, protocol, TLS, eviction, persistence, HA, backup, memory, connection và ops quota, ping result, ngày xác minh. Nếu dashboard khác expectation, dashboard là nguồn thật và cần đánh giá blocker; không sửa tài liệu để giả PASS.

Tham chiếu: [Redis Cloud Essentials plan](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/) và [Redis Cloud TLS](https://redis.io/docs/latest/operate/rc/security/database-security/tls-ssl/).

## 3. Chuẩn bị Cloudinary

1. Tạo/select cloud dành cho demo.
2. Lấy `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
3. Nhập trực tiếp vào Render secret manager; không commit hoặc gửi lại secret.
4. Ghi tier, quota liên quan và ngày xác minh từ dashboard Phase 8.

Tham chiếu: [Cloudinary pricing](https://cloudinary.com/pricing).

## 4. Deploy backend Render từ repository root

1. Chọn New → Blueprint và kết nối backend repository.
2. Dùng `render.yaml` ở root. Xác nhận `runtime: docker`, `plan: free`, `region: singapore`, `numInstances: 1`, `./Dockerfile`, `/health/ready` theo Blueprint.
3. Root Directory để `.` hoặc trống. Không set Docker Command để image dùng `CMD ["npm", "run", "start:prod"]`.
4. Nhập các giá trị `sync: false`: `MONGODB_URI`, `REDIS_URL`, ba Cloudinary keys, hai JWT secrets và `CORS_ORIGIN` tạm phù hợp URL frontend đang kiểm tra. Không gửi lại giá trị secret.
5. Xác nhận preset `SOCKET_ADAPTER_MODE=memory`, `MEDIA_PROCESSING_MODE=inline`, `CONVERSATION_MESSAGE_CACHE_MODE=off` và notification flags từ Blueprint.
6. Deploy. Trong log an toàn cần thấy database/index/Redis ready, media inline, notification worker/outbox enabled và server listening; không được thấy URI, token hoặc password.
7. Trên `.onrender.com`, kiểm tra lần lượt `/health/live` → `200`, `/health/ready` → `200`, `/api-docs` load được. Tách lỗi deploy khỏi DNS trước khi đi tiếp.

Blueprint syntax tham chiếu hiện hành: [Render Blueprint YAML](https://render.com/docs/blueprint-spec) và [Docker on Render](https://render.com/docs/docker). Quota/sleep/cold-start phải kiểm tra lại dashboard/docs tại ngày deploy.

## 5. Backend custom domain

1. Trong Render service → Settings → Custom Domains, add `api.x.cacbonat.top`.
2. Tại DNS provider của `cacbonat.top`, tạo đúng record type/name/target Render dashboard hiển thị. Không dùng target ví dụ hoặc tài liệu cũ.
3. Chờ Render báo verified và HTTPS certificate active.
4. Kiểm tra qua custom domain: `/health/live`, `/health/ready`, `/api-docs` đều HTTPS và không certificate error.

Chỉ tiếp tục khi backend custom domain PASS.

## 6. Deploy frontend Vercel từ repository root

1. Import frontend repository vào Vercel; Root Directory để `.` hoặc trống.
2. Dùng framework Next.js native, không thêm `vercel.json` khi dashboard không yêu cầu override.
3. Đặt production env `NEXT_PUBLIC_API_URL=https://api.x.cacbonat.top/api` trước build. Đây là public URL, không phải secret.
4. Deploy rồi kiểm tra `.vercel.app`: frontend load và request đi tới backend custom domain.
5. Add `x.cacbonat.top` trong Project → Settings → Domains.
6. Tạo đúng DNS record/target Vercel dashboard cấp và chờ verified + HTTPS.
7. Mở `https://x.cacbonat.top`; browser không redirect sang `.vercel.app`.

Tham chiếu: [Vercel domains](https://vercel.com/docs/domains) và [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 7. Chốt CORS và runtime wiring

1. Trong Render Environment, đặt exact `CORS_ORIGIN=https://x.cacbonat.top`.
2. Restart/redeploy backend một lần nếu Render yêu cầu.
3. Trong browser Network/Socket, xác nhận HTTP API base là `https://api.x.cacbonat.top/api` và Socket.IO origin là `https://api.x.cacbonat.top`.
4. Xác nhận credentialed request không bị CORS chặn, không mixed-content và không certificate error.
5. Sau đó mới chạy P0 smoke của Phase 8 qua custom domain.

## Evidence record cho Phase 8

Ghi ngày xác minh và nguồn dashboard cho:

- Render/Vercel: provider URL, tier, region, deployed commit/image, sleep/cold-start/restart behavior.
- MongoDB: tier/region/version/transaction result.
- Redis: tier/region/version/protocol/TLS/eviction/persistence/HA/backup/quota và connection count thực tế.
- Cloudinary: tier/quota ảnh hưởng upload.
- Domain: record type/name/target đã redact nếu cần, verification/HTTPS state.
- HTTP: status của health/live, health/ready, api-docs qua provider domain và custom domain.

Không chụp/log secret. Screenshot phải che URI, password, token, key và cookie.

## Rollback

1. Nếu frontend release lỗi, rollback Vercel deployment trước; giữ backend/env contract tương thích.
2. Nếu backend release lỗi, rollback Render image/deployment trước và kiểm tra lại health.
3. Nếu một capability gây blocker, giữ một instance và dùng preset `memory + inline + off`; không thêm service/worker mới như workaround.
4. Nếu queue mode từng được bật, reconcile/giải quyết media `pending` trước khi chuyển `inline`; không xóa Redis/Mongo tùy tiện.
5. DNS rollback dùng record trước đã ghi từ provider; không đoán target.
6. Native Node chỉ là fallback khi Docker blocker có evidence: `npm ci && npm run build`, `npm run start:prod`, giữ nguyên env/health contract.
