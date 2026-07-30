Dựa trên hai tài liệu:

- `d:/NodeJS/X-full/X-ver2/input-noti.md`
- `d:/NodeJS/X-full/X-ver2/noti-review.md`

hãy lập một **kế hoạch triển khai backend notification hoàn chỉnh, chi tiết và có thể thực thi tuần tự** cho dự án hiện tại.

Bạn có thể tham khảo cách tổ chức kế hoạch trong tài liệu:

- `phase-ui-chat.md`

đặc biệt là cách chia phase nhỏ, chỉ rõ file tạo mới, file sửa, dependency và gate hoàn thành. Tuy nhiên, không được sao chép máy móc kế hoạch đó vì notification là một hệ thống khác và chỉ triển khai ở backend.

## 1. Việc bắt buộc phải làm trước khi lập kế hoạch

Hãy đọc lại mã nguồn hiện tại thay vì chỉ dựa vào kết luận trong `noti-review.md`.

Tối thiểu phải kiểm tra các khu vực:

```text
src/modules/notification
src/modules/user
src/modules/tweet
src/modules/conversation
src/socket
src/schemas
src/constants/enums
src/config
src/queues
src/app.ts
endpoint.md
swagger.yaml
```

Ngoài ra, hãy tìm tất cả nơi hiện đang:

- tạo notification;
- emit notification qua Socket.IO;
- tạo hoặc cập nhật message;
- mark message/notification là đã đọc;
- xử lý follow, like, repost, quote, reply và mention;
- xử lý reaction message;
- thêm, xóa, kick hoặc thay đổi quyền thành viên group;
- tạo index liên quan.

Phải xác nhận lại tên file, method, schema, collection, REST endpoint và socket event từ code thật. Không được coi danh sách file trong `noti-review.md` là tuyệt đối chính xác nếu code hiện tại đã khác.

Nếu phát hiện nhận định trong `noti-review.md` không còn đúng với code hiện tại, hãy ghi rõ điểm khác biệt và lập kế hoạch theo code thật.

## 2. Mục tiêu của kế hoạch

Kế hoạch phải đưa hệ thống từ kiến trúc hiện tại tới trạng thái đáp ứng đầy đủ các yêu cầu trong `input-noti.md`, bao gồm:

### Social notification

- Follow.
- Người được follow đăng tweet gốc, có cơ chế bật/tắt theo từng follow relation.
- Like tweet.
- Repost tweet.
- Quote tweet.
- Reply tweet.
- Mention trong tweet, reply và quote.
- Aggregation cho like và repost.
- Deduplication giữa reply, quote và mention.
- Xử lý unlike, undo repost, xóa target, block và self-interaction.

### Notification state

- Danh sách notification có phân trang ổn định.
- Mark one as read.
- Mark all as read.
- Unread count chính xác.
- Đồng bộ nhiều tab hoặc nhiều thiết bị.
- Reconcile lại state sau socket reconnect.
- Không tạo notification trùng khi request hoặc worker retry.

### Messaging — ưu tiên cao nhất

- Direct message mới.
- Group message mới.
- Reply message.
- Mention trong group.
- Reaction message.
- Unread count từng conversation.
- Tổng unread message.
- Tổng số conversation có tin chưa đọc để hiển thị badge hộp thư.
- Read acknowledgement theo message hoặc read position.
- Xử lý đúng khi user đang mở conversation.
- Các đường tạo message như send, forward và các luồng tương đương phải dùng chung logic, không được mỗi đường cập nhật unread/notification khác nhau.

### Group events

- Thành viên được thêm hoặc tham gia.
- Thành viên tự rời.
- Thành viên bị kick.
- Được cấp quyền admin.
- Bị thu hồi quyền admin.

Phải xác định rõ sự kiện nào là:

- notification cá nhân;
- system message trong conversation;
- realtime conversation event;
- hoặc kết hợp.

### Reliability và khả năng mở rộng

- Domain event typed.
- Idempotency.
- Deduplication.
- Aggregation.
- Reliable persistence.
- Realtime delivery.
- Retry/backoff.
- BullMQ nếu phù hợp.
- Transactional outbox nếu thực sự cần.
- Fan-out notification tweet mới theo batch.
- Đường mở rộng cho push notification trong tương lai, nhưng chưa triển khai push ở kế hoạch hiện tại.

Các yêu cầu nghiệp vụ, edge case và delivery matrix trong `input-noti.md` được coi là phạm vi bắt buộc. Không được bỏ qua chỉ vì code hiện tại chưa hỗ trợ.

## 3. Nguyên tắc kiến trúc

Kế hoạch cần hướng hệ thống về luồng rõ ràng:

```text
Business mutation
    → Domain event
    → Notification policy/handler
    → Persistence hoặc aggregation
    → Unread state update
    → Realtime delivery
```

Nếu sử dụng outbox và queue:

```text
Business transaction
    → Business data + Outbox event
    → Outbox publisher
    → BullMQ worker
    → Notification policy
    → Notification persistence
    → Realtime delivery
```

Phải phân tách rõ trách nhiệm của:

- business service;
- domain event publisher;
- notification policy hoặc handler;
- notification repository;
- aggregation logic;
- unread state;
- Socket.IO delivery;
- queue/worker;
- system message;
- conversation unread state.

Không được tiếp tục để controller, tweet service, user service và socket handler tự quyết định và tự insert notification theo nhiều cách khác nhau.

Tuy nhiên, không được over-engineer một lần. Kiến trúc mới phải được đưa vào theo kiểu additive và migrate dần, giữ hệ thống chạy được sau mỗi phase.

## 4. Quy tắc chia phase

Chia kế hoạch thành các phase nhỏ, tuần tự và có dependency rõ ràng.

Mỗi phase chỉ nên thực hiện:

- một thay đổi kiến trúc nền tảng; hoặc
- tối đa 1–2 nhóm hành vi liên quan chặt chẽ.

Không gom các việc sau vào cùng một phase lớn:

- đổi toàn bộ schema;
- thêm domain event;
- thêm outbox;
- thêm aggregation;
- thay unread message;
- và triển khai tất cả social/message notification.

Nếu một phase phải sửa quá nhiều module, hãy tiếp tục tách nhỏ.

Thứ tự ưu tiên nên là:

1. Khóa contract và baseline.
2. Sửa lỗi nền tảng có thể làm hỏng mọi phase sau.
3. Mở rộng schema/index theo kiểu backward-compatible.
4. Tách persistence, policy và delivery.
5. Thêm idempotency/domain events.
6. Chỉ sau đó mới thêm queue/outbox nếu cần.
7. Notification social cơ bản.
8. Aggregation và undo reconciliation.
9. Notification unread state.
10. Message unread state.
11. Message/group notification.
12. Tweet notification fan-out.
13. Cleanup, migration removal và observability.

Đây chỉ là định hướng. Sau khi đọc code, bạn được quyền điều chỉnh thứ tự nếu có lý do kỹ thuật rõ ràng.

Messaging là ưu tiên cao nhất về sản phẩm, nhưng không được triển khai message unread trước khi các nền tảng schema, idempotency và luồng message thống nhất đủ an toàn.

## 5. Nội dung bắt buộc của từng phase

Mỗi phase phải có đúng cấu trúc sau:

### Phase N — Tên phase

**Mục tiêu**

Nói rõ phase này giải quyết vấn đề gì và đóng góp gì cho kiến trúc notification tổng thể.

**Phạm vi chức năng**

Chỉ rõ 1–2 chức năng hoặc nhóm logic được triển khai trong phase.

**Phụ thuộc**

- Cần phase nào hoàn thành trước.
- Vì sao có dependency đó.
- Phase nào về sau sẽ phụ thuộc vào phase hiện tại.

**File tạo mới**

Liệt kê đường dẫn chính xác của từng file và trách nhiệm của file.

Ví dụ:

```text
src/modules/notification/notification.repository.ts
```

Không được chỉ ghi “tạo repository” mà không chỉ rõ vị trí và trách nhiệm.

**File sửa**

Liệt kê đường dẫn chính xác và nội dung thay đổi chính trong từng file.

Không liệt kê file chỉ vì “có thể liên quan”. Chỉ ghi những file dự kiến thực sự phải chạm.

**Schema và index**

Nếu phase thay đổi dữ liệu, phải nói rõ:

- field thêm mới;
- field giữ lại để tương thích;
- field nào chỉ dual-write;
- index tạo mới;
- unique hoặc partial index;
- dữ liệu cũ được xử lý thế nào;
- có cần migration/backfill hay lazy migration không.

**Luồng xử lý sau phase**

Mô tả bằng sơ đồ text ngắn, ví dụ:

```text
TweetService.likeTweet()
    → publish TweetLiked
    → TweetLikedNotificationHandler
    → upsert aggregate
    → update NotificationState
    → emit @notification:updated
```

**Quy tắc nghiệp vụ và edge case**

Nêu cụ thể các trường hợp phase phải xử lý:

- self-action;
- block/privacy;
- retry;
- duplicate;
- undo;
- target deleted;
- race condition;
- multi-device;
- socket failure;
- transaction failure;
- aggregation count;
- read/unread transition.

Không cần lặp toàn bộ edge case của hệ thống trong mọi phase; chỉ liệt kê edge case liên quan trực tiếp.

**Tương thích và migration**

Phải nói rõ:

- REST contract nào được giữ nguyên;
- socket event nào được giữ nguyên;
- field cũ nào vẫn được trả;
- có dual-read hoặc dual-write không;
- khi nào mới được bỏ logic cũ;
- frontend hiện tại có bị ảnh hưởng không.

Trong toàn bộ kế hoạch, ưu tiên giữ:

```text
@notification:new
```

và các REST endpoint notification hiện tại cho đến khi có phase migration rõ ràng.

**Kiểm thử**

Chỉ rõ test cần thêm hoặc test thủ công cần chạy:

- unit;
- integration;
- database/index;
- socket;
- retry/idempotency;
- race/concurrency;
- regression.

Nếu repository hiện chưa có test framework phù hợp, không được tự ý cài một framework mới trong phase lập kế hoạch. Hãy ghi rõ kiểm tra bằng build, typecheck, API/socket test script hoặc test thủ công; việc thêm framework phải là quyết định riêng.

**Gate hoàn thành**

Gate phải đo được, không dùng các câu mơ hồ như:

- “chạy ổn”;
- “hoạt động tốt”;
- “không có lỗi”.

Ví dụ gate tốt:

```text
Gửi lại cùng event_id ba lần chỉ tạo đúng một notification.
Hai actor like đồng thời làm actor_count tăng đúng hai.
Unlike một actor chỉ giảm count một lần.
Frontend cũ vẫn nhận @notification:new với các field hiện có.
```

**Rollback**

Nêu cách revert phase mà không phá dữ liệu hoặc các phase đã hoàn thành trước đó.

## 6. Các quyết định phải được chốt trong kế hoạch

Không để các vấn đề sau ở trạng thái mơ hồ:

### Notification aggregation

Phải chốt:

- loại nào aggregate;
- aggregation key;
- deduplication key;
- cách lưu actor preview;
- actor count;
- cách xử lý actor bị xóa;
- unlike/undo;
- notification aggregate đã đọc nhưng có actor mới thì chuyển unread thế nào;
- khi actor count về 0 thì xóa hay invalidate.

### Reply/quote/mention

Phải chốt precedence khi một event có nhiều intent.

Ví dụ cần xác định rõ:

```text
Quote > Reply > Mention
```

hoặc quy tắc khác nếu code/domain cho thấy hợp lý hơn.

Một recipient không được nhận nhiều notification trùng cho cùng một source event nếu nội dung thực chất giống nhau.

### Notification badge

Phải chốt notification badge là:

```text
số notification item chưa đọc
```

Một aggregate có 100 actor chỉ được tính là một unread item, trừ khi có lý do khác rõ ràng.

### Message badge

Phải chốt icon hộp thư hiển thị:

```text
số conversation có ít nhất một message chưa đọc
```

Backend vẫn nên có khả năng trả:

- `unread_conversation_count`;
- `total_unread_message_count`;
- `unread_message_count` từng conversation.

### Message read model

Phải chốt mô hình nguồn sự thật, ví dụ:

- `ConversationMembership`;
- `last_read_message_id`;
- `last_read_at`;
- `unread_message_count`.

Nếu migrate khỏi `Message.read_by`, phải có phase dual-write, backfill và điều kiện loại bỏ field/logic cũ.

### Message idempotency

Phải chốt cơ chế chống gửi message trùng do socket retry, ví dụ:

```text
sender_id + client_message_id
```

với unique index hoặc cơ chế tương đương.

### Group event

Phải có bảng xác định rõ:

| Event | Người nhận notification | System message | Realtime event | Unread message |
| ----- | ----------------------- | -------------- | -------------- | -------------- |

cho:

- member added;
- member joined;
- member left;
- member kicked;
- admin granted;
- admin revoked.

### Tweet notification fan-out

Phải chốt:

- preference được lưu ở đâu;
- mặc định bật hay tắt;
- chỉ tweet gốc nào được tính;
- cách lấy recipient;
- batch size;
- queue job structure;
- retry/idempotency;
- rate limit/backpressure;
- không làm request tạo tweet phải chờ fan-out hoàn tất.

### Outbox và BullMQ

Không mặc định thêm vì “kiến trúc chuẩn”.

Phải giải thích:

- vấn đề cụ thể nào trong code hiện tại yêu cầu outbox;
- phase nào bắt đầu dùng;
- collection/index/jobId;
- transaction boundary;
- publisher hoạt động thế nào;
- retry và failed job;
- cách tránh worker chạy hai lần tạo duplicate;
- vì sao một event emitter nội bộ hoặc enqueue trực tiếp là chưa đủ.

Nếu MongoDB deployment hiện tại không hỗ trợ transaction đáng tin cậy, phải nêu rõ giới hạn và đưa ra phương án phù hợp thay vì lập kế hoạch dựa trên giả định sai.

## 7. Tổ chức file

Phải bám sát kiến trúc module hiện tại của backend.

Ưu tiên đặt logic notification trong:

```text
src/modules/notification
```

Các phần dùng chung thật sự mới được đặt ở:

```text
src/modules/events
src/queues
src/schemas
```

Không tạo các file generic hoặc thư mục mới một cách tùy ý như:

```text
helpers/
utils/
common/
services/
```

nếu codebase chưa có convention rõ ràng cho chúng.

Nếu đề xuất cấu trúc khác với module hiện tại, phải giải thích:

- vấn đề của cấu trúc cũ;
- boundary mới;
- trách nhiệm từng thư mục;
- vì sao không thể đặt trong module notification;
- cách tránh circular dependency.

Không được tạo một file rất lớn chứa cả:

- policy;
- persistence;
- unread;
- aggregation;
- queue;
- Socket.IO delivery.

Ngược lại, cũng không được chia thành quá nhiều file một method nếu không có boundary nghiệp vụ thực sự.

## 8. Giới hạn phạm vi

Kế hoạch này chỉ dành cho backend.

Không sửa frontend.

Có thể mô tả contract mà frontend sẽ sử dụng, nhưng không lập phase triển khai component, React Query hoặc UI.

Không triển khai web push/mobile push ở lần này. Chỉ giữ abstraction hoặc delivery preference phù hợp để mở rộng sau.

Không refactor các module không liên quan chỉ để “làm sạch code”.

Không đổi tên hàng loạt các field, endpoint hoặc socket event legacy trong một phase.

Không viết lại toàn bộ notification system từ đầu nếu có thể migrate an toàn từ code hiện tại.

Không được dùng mock hoặc logic tạm để bỏ qua một backend gate chưa hoàn thành.

## 9. Kết quả đầu ra cần trả về

Tài liệu kế hoạch cuối cùng phải gồm:

1. **Mục tiêu cuối cùng của backend notification.**
2. **Tóm tắt code hiện tại đã kiểm tra**, gồm các file và luồng thực tế quan trọng.
3. **Các quyết định kiến trúc đã chốt.**
4. **Những điểm trong `noti-review.md` được giữ, điều chỉnh hoặc loại bỏ.**
5. **Nguyên tắc chia phase.**
6. **Kế hoạch từng phase theo đúng cấu trúc bắt buộc.**
7. **Bảng dependency giữa các phase.**
8. **Notification event matrix cuối cùng.**
9. **Bảng schema/index theo từng phase migration.**
10. **Danh sách các contract REST và Socket.IO phải giữ tương thích.**
11. **Những mục chủ động không làm trong kế hoạch này.**
12. **Các mốc release có thể rollback độc lập.**
13. **Checklist nghiệm thu toàn hệ thống sau phase cuối.**

Kế hoạch phải đủ cụ thể để sau đó có thể giao cho AI triển khai lần lượt từng phase mà không cần AI tự suy diễn lại kiến trúc.

## 10. Quy tắc thực thi ở bước hiện tại

Ở bước này:

- chỉ đọc code;
- phân tích;
- và viết kế hoạch.

Không sửa code.

Không tạo file source mới.

Không chạy migration thay đổi dữ liệu.

Không tự đánh dấu phase là đã hoàn thành.

Mọi phase ban đầu phải có trạng thái:

```text
Trạng thái: Chưa triển khai
```

Nếu còn điểm chưa thể xác nhận từ code, hãy ghi rõ dưới dạng:

```text
Cần xác minh trước khi triển khai Phase N
```

thay vì tự giả định.

Cuối cùng, hãy lưu toàn bộ kế hoạch vào:

```text
d:/NodeJS/X-full/X-ver2/phase-notification.md
```

Sau khi tạo tài liệu, chỉ tóm tắt:

- tổng số phase;
- các dependency quan trọng;
- phase nên bắt đầu đầu tiên;
- các rủi ro lớn nhất.

Không bắt đầu triển khai Phase 1 cho đến khi tôi yêu cầu riêng.
