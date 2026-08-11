Hãy kiểm tra toàn bộ kiến trúc notification hiện tại của backend và đánh giá xem thiết kế có:

- đúng về mặt nghiệp vụ;
- dễ đọc và dễ bảo trì;
- dễ mở rộng thêm loại notification;
- tránh tạo notification trùng;
- hỗ trợ realtime tốt;
- xử lý được unread count;
- phù hợp khi hệ thống có nhiều người dùng và nhiều sự kiện.

Không chỉ xem model notification, hãy kiểm tra toàn bộ luồng liên quan, bao gồm:

- nơi phát sinh domain event;
- service tạo notification;
- database schema và index;
- Socket.IO event;
- unread count;
- read/unread state;
- aggregation;
- permission và privacy;
- xử lý xóa hoặc thay đổi dữ liệu nguồn.

Trước tiên, hãy mô tả kiến trúc notification hiện tại đang hoạt động như thế nào. Sau đó chỉ ra:

1. Điểm đang làm tốt.
2. Điểm chưa hợp lý.
3. Những đoạn code bị coupling cao, khó bảo trì hoặc khó mở rộng.
4. Các lỗi hoặc edge case có thể xảy ra.
5. Kiến trúc đề xuất.
6. Danh sách file cần sửa.
7. Thứ tự refactor an toàn, tránh phá vỡ chức năng hiện tại.

## Các nghiệp vụ backend bắt buộc phải hỗ trợ

### 1. Follow

Tạo notification khi một người dùng follow người khác.

Ví dụ:

> A đã theo dõi bạn.

Không tạo notification khi:

- người dùng tự follow chính mình;
- quan hệ follow đã tồn tại;
- người dùng unfollow;
- một trong hai bên đã block bên còn lại.

### 2. Người đang follow đăng tweet mới

Khi người dùng A đang follow người dùng B và B tạo một tweet mới, A có thể nhận notification.

Chỉ tạo notification khi B trực tiếp tạo một tweet gốc.

Không tạo notification khi B:

- repost tweet;
- quote tweet;
- reply tweet;
- chỉnh sửa tweet;
- khôi phục hoặc thao tác lại với tweet cũ.

Cần kiểm tra khả năng mở rộng để sau này người dùng có thể bật hoặc tắt loại notification này cho từng tài khoản đang follow.

Lưu ý: loại notification này có thể tạo fan-out rất lớn. Hãy đánh giá rõ nên dùng fan-out on write, fan-out on read, queue hay giải pháp kết hợp.

### 3. Tương tác với tweet

Chủ sở hữu tweet cần nhận notification khi có người:

- like tweet;
- repost tweet;
- quote tweet;
- reply tweet.

Không tạo notification cho:

- bookmark;
- view;
- unlike;
- undo repost;
- xóa bookmark.

Không gửi notification khi người dùng tự tương tác với tweet của chính mình.

#### Aggregation

Like và repost cần hỗ trợ gom notification.

Ví dụ:

> A, B và 98 người khác đã thích bài viết của bạn.

Cần đánh giá schema hiện tại có hỗ trợ tốt việc aggregation hay không, bao gồm:

- nhiều actor cùng thực hiện một action trên cùng target;
- cập nhật actor gần nhất;
- tổng số actor;
- tránh tạo một document notification cho từng lượt like nếu không cần thiết;
- xử lý khi một người unlike hoặc undo repost;
- giữ unread state hợp lý sau khi notification được cập nhật.

Quote tweet và reply nên được giữ thành notification riêng vì mỗi sự kiện có nội dung và target riêng.

### 4. Mention

Tạo notification khi người dùng được mention trong nội dung tweet.

Mention phải hoạt động với mọi loại tweet có nội dung văn bản, bao gồm:

- tweet gốc;
- reply;
- quote tweet.

Không phụ thuộc vào quan hệ cha-con của tweet.

Cần xử lý:

- một người bị mention nhiều lần trong cùng một tweet nhưng chỉ nhận một notification;
- mention chính mình;
- username không tồn tại;
- tài khoản bị block;
- chỉnh sửa tweet làm thay đổi danh sách mention;
- tweet bị xóa;
- một sự kiện vừa là reply vừa là mention.

Nếu một reply vừa trả lời người dùng vừa mention chính người đó, cần đề xuất quy tắc tránh tạo hai notification gây trùng nội dung.

## 5. Messaging — ưu tiên cao nhất

Hệ thống messaging phải hỗ trợ tốt realtime notification và unread count.

### Tin nhắn trực tiếp và tin nhắn nhóm

Cần hỗ trợ:

- tin nhắn mới;
- tin nhắn nhóm mới;
- reaction vào tin nhắn;
- reply một tin nhắn;
- mention thành viên trong nhóm.

Không gửi notification cho chính người thực hiện hành động.

### Unread state

Cần phân biệt rõ:

- tổng số tin nhắn chưa đọc;
- số conversation có tin nhắn chưa đọc;
- unread count của từng conversation;
- thời điểm người dùng đọc đến đâu trong conversation;
- trạng thái đã nhận qua socket nhưng chưa mở conversation;
- trạng thái đang mở đúng conversation khi tin nhắn mới đến.

Hãy đề xuất cách lưu unread state phù hợp, ví dụ:

- `lastReadMessageId`;
- `lastReadAt`;
- unread counter;
- bảng hoặc collection membership của conversation.

Không nên tính lại toàn bộ số tin chưa đọc bằng cách scan tất cả message sau mỗi request.

Backend cần cung cấp dữ liệu để frontend hiển thị badge tại icon hộp thư.

Cần nêu rõ badge nên đại diện cho:

- tổng số tin nhắn chưa đọc; hay
- số conversation có tin nhắn chưa đọc.

Hãy chọn một cách phù hợp và giải thích lý do.

### Reply tin nhắn

Khi một người reply tin nhắn của người khác:

- người gửi tin nhắn gốc có thể nhận notification;
- các thành viên còn lại vẫn nhận event tin nhắn mới theo quy tắc conversation;
- tránh gửi hai notification trùng cho cùng một người nếu họ vừa là thành viên nhận tin nhắn mới vừa là chủ tin nhắn được reply.

### Mention trong nhóm

Khi người dùng được mention trong tin nhắn nhóm:

- cần có notification riêng hoặc mức ưu tiên cao hơn tin nhắn nhóm thông thường;
- tránh tạo hai notification trùng nhau;
- vẫn cập nhật unread state của conversation.

### Reaction tin nhắn

Tạo notification cho người gửi tin nhắn khi người khác react.

Cần xử lý:

- thay đổi reaction;
- xóa reaction;
- react nhiều lần;
- nhiều người react cùng một tin nhắn;
- aggregation nếu phù hợp.

### Sự kiện quản lý nhóm

Thành viên liên quan cần nhận notification khi:

- có người tham gia nhóm;
- có người rời nhóm;
- một người được cấp quyền admin;
- một người bị thu hồi quyền admin;
- một người bị buộc rời khỏi nhóm.

Cần xác định rõ ai là người nhận của từng loại sự kiện.

Ví dụ:

- sự kiện tham gia hoặc rời nhóm có thể hiển thị như system message trong conversation;
- người được cấp hoặc thu hồi quyền admin phải nhận notification trực tiếp;
- người bị kick phải nhận notification trực tiếp;
- các thành viên còn lại có thể nhận system event qua conversation thay vì notification cá nhân.

Hãy đánh giá nên lưu các sự kiện này dưới dạng:

- notification;
- system message;
- conversation event;
- hoặc kết hợp nhiều loại.

## Yêu cầu kiến trúc

Hãy đánh giá và đề xuất kiến trúc có sự phân tách rõ giữa:

1. Domain event
   Ví dụ: `TweetLiked`, `UserFollowed`, `MessageCreated`.

2. Notification generation
   Quyết định sự kiện nào tạo notification và ai là người nhận.

3. Notification persistence
   Lưu notification, aggregation, read/unread và index.

4. Realtime delivery
   Gửi Socket.IO event cho người dùng đang online.

5. Push delivery
   Thiết kế mở rộng để sau này có thể gửi web push hoặc mobile push, nhưng hiện tại chưa bắt buộc triển khai.

Không để các controller hoặc service nghiệp vụ tự tạo notification theo nhiều cách khác nhau.

Ưu tiên một luồng thống nhất như:

```text
Business action
    → Domain event
    → Notification handler
    → Persist notification
    → Emit realtime event
    → Update unread counter
```

Cần đánh giá có nên sử dụng:

- event emitter nội bộ;
- Redis Pub/Sub;
- BullMQ;
- transactional outbox;
- idempotency key;
- retry và dead-letter queue.

Không cần áp dụng tất cả. Hãy chọn giải pháp phù hợp với quy mô hiện tại của dự án nhưng vẫn có đường nâng cấp rõ ràng.

## Data model

Hãy đánh giá notification schema hiện tại và đề xuất schema tốt hơn nếu cần.

Schema nên cân nhắc các trường:

```ts
type Notification = {
  id: string
  recipientId: string

  type: NotificationType

  actorIds: string[]
  actorCount: number

  targetType?: 'USER' | 'TWEET' | 'MESSAGE' | 'CONVERSATION'
  targetId?: string

  context?: Record<string, unknown>

  aggregationKey?: string
  deduplicationKey?: string

  isRead: boolean
  readAt?: Date

  createdAt: Date
  updatedAt: Date
}
```

Đây chỉ là gợi ý. Không bắt buộc giữ nguyên nếu có thiết kế tốt hơn.

Cần đề xuất index phục vụ:

- lấy notification theo recipient;
- phân trang theo thời gian;
- lọc unread;
- aggregation;
- chống duplicate;
- truy vấn unread count.

## Phân loại delivery

Cần phân biệt:

- In-app notification: xuất hiện trong tab notification.
- Realtime event: gửi qua Socket.IO.
- Badge count: số lượng chưa đọc.
- System message: sự kiện nằm trong conversation.
- Push notification: thông báo ngoài ứng dụng.

Không phải mọi domain event đều cần xuất hiện ở cả năm nơi.

Hãy lập bảng mapping cho từng nghiệp vụ, ví dụ:

| Event               |           In-app | Socket | Badge | System message |     Push |
| ------------------- | ---------------: | -----: | ----: | -------------: | -------: |
| User followed       |               Có |     Có |    Có |          Không | Tùy chọn |
| Tweet liked         |     Có, được gom |     Có |    Có |          Không |    Không |
| Message created     |           Tùy UI |     Có |    Có |          Không |       Có |
| Member joined group | Không nhất thiết |     Có | Không |             Có |    Không |

## Edge cases bắt buộc kiểm tra

- Không gửi notification cho chính actor.
- Block hoặc privacy.
- Sự kiện được gửi lại do retry.
- Một request bị xử lý hai lần.
- Socket reconnect.
- Người dùng mở nhiều tab hoặc nhiều thiết bị.
- Notification được tạo nhưng emit socket thất bại.
- Emit socket thành công nhưng transaction database rollback.
- Target bị xóa.
- Actor bị khóa hoặc xóa tài khoản.
- Phân trang notification trong lúc có notification mới.
- Race condition khi nhiều người cùng like.
- Race condition khi cập nhật unread counter.
- Một event tạo nhiều loại notification trùng nhau.
- Group có nhiều thành viên.
- User đang mở đúng conversation khi message đến.

## Kết quả đầu ra mong muốn

Sau khi kiểm tra code, hãy trả về:

1. Sơ đồ luồng kiến trúc hiện tại.
2. Đánh giá mức độ bảo trì và mở rộng.
3. Danh sách vấn đề theo mức độ:
   - Critical;
   - High;
   - Medium;
   - Low.

4. Kiến trúc đề xuất.
5. Notification event matrix.
6. Schema và index đề xuất.
7. Quy tắc aggregation và deduplication.
8. Cách quản lý unread count cho notification và message.
9. Danh sách file cần sửa.
10. Kế hoạch refactor theo từng phase.
11. Sau đó mới thực hiện sửa code.

Không được viết lại toàn bộ hệ thống ngay từ đầu nếu chưa cần thiết. Ưu tiên tận dụng code hiện tại, refactor từng bước và giữ tương thích với API cũng như Socket.IO event hiện có.
