# Software Requirements Specification (SRS)

## Clone X (Twitter Clone) Backend API

### 1. Mô tả tổng quan (Overview)

Dự án là một hệ thống mạng xã hội (tương tự như X/Twitter), cho phép người dùng chia sẻ cảm nghĩ (Tweet), theo dõi người khác (Follow), tương tác (Like, Bookmark, Comment, Retweet) và giao tiếp trực tiếp với nhau thông qua nhắn tin (1-1 hoặc theo nhóm). Hệ thống này hiện tại được xây dựng phía backend nhằm cung cấp các API và dịch vụ thời gian thực (real-time) để phục vụ cho các ứng dụng client (Web, Mobile).

### 2. Phạm vi (Scope)

Hệ thống backend đảm nhận các trách nhiệm sau:

- Cung cấp API RESTful cho các tác vụ CRUD (Tạo, Đọc, Cập nhật, Xóa) liên quan đến User, Tweet, Follow, Bookmark, Like, Conversation, Message, Notification.
- Xử lý xác thực (Authentication) và phân quyền (Authorization).
- Quản lý kết nối thời gian thực (Real-time) qua WebSocket cho tính năng nhắn tin và thông báo.
- Xử lý các tác vụ đa phương tiện (Upload ảnh, xử lý video bằng hàng đợi).
- Đóng gói và chuẩn bị môi trường tài liệu API thông qua Swagger.

### 3. Giới hạn (Limitations)

- Hệ thống chỉ cung cấp Backend API, không bao gồm giao diện người dùng (Frontend).
- Kích thước tập tin tải lên (ảnh/video) bị giới hạn bởi cấu hình của server để đảm bảo hiệu suất.
- Tính năng xử lý video đòi hỏi tài nguyên hệ thống cao, yêu cầu phải có Redis để chạy hàng đợi.
- Giới hạn tốc độ gọi API (Rate Limiting) để phòng tránh spam.

### 4. Công nghệ sử dụng (Backend Technologies)

Hệ thống được phát triển với các công nghệ và thư viện hiện đại:

- **Ngôn ngữ lập trình:** TypeScript, Node.js
- **Framework:** Express.js (v5.1.0)
- **Cơ sở dữ liệu:**
  - **MongoDB:** Lưu trữ dữ liệu chính (NoSQL)
  - **Redis (ioredis):** Caching và làm storage cho Message Queue
- **Message Queue:** BullMQ (Xử lý các tác vụ nền như xử lý video stream, gửi email)
- **Realtime:** Socket.io (WebSocket)
- **Xử lý Đa phương tiện:**
  - `sharp`: Tối ưu và chỉnh sửa hình ảnh.
  - `cloudinary`: Tích hợp lưu trữ cloud cho media (ảnh, video).
  - `formidable`: Xử lý multipart/form-data.
- **Bảo mật & Xác thực:**
  - `bcrypt`: Mã hóa mật khẩu.
  - `jsonwebtoken` (JWT): Quản lý token xác thực (Access Token, Refresh Token).
  - `helmet`: Thiết lập HTTP headers bảo vệ ứng dụng.
  - `express-rate-limit`: Chống brute-force và DDoS mức cơ bản.
  - `cors`: Cấu hình Cross-Origin Resource Sharing.
- **Xác thực dữ liệu:** `zod`
- **Dịch vụ Email:** `@sendgrid/mail`, `resend`
- **Tài liệu API:** `swagger-jsdoc`, `swagger-ui-express`

### 5. Các chức năng (Features)

- **Auth (Xác thực):** Đăng ký, Đăng nhập, Đăng xuất, Làm mới token (Refresh Token), Quên/Reset mật khẩu, Xác thực email.
- **User (Người dùng):** Lấy thông tin cá nhân, cập nhật hồ sơ (avatar, cover, bio), xem hồ sơ người khác.
- **Follow (Mạng lưới):** Theo dõi/bỏ theo dõi (Follow/Unfollow), xem danh sách người theo dõi hoặc đang theo dõi. Trạng thái quan hệ bạn bè (mutual follow).
- **Tweet (Bài đăng):**
  - Tạo Tweet (có đính kèm ảnh, video, mentions, hashtags).
  - Tương tác với Tweet: Retweet, Quote Tweet, Comment.
  - Phạm vi hiển thị: Public (Mọi người) hoặc Twitter Circle (Chỉ bạn bè thân thiết).
- **Tương tác (Interactions):** Thích (Like) và lưu trữ (Bookmark) Tweet.
- **Giao tiếp (Conversations/Messages):**
  - Nhắn tin 1-1 (Direct Conversation).
  - Nhắn tin nhóm (Group Conversation) với các vai trò Admin/Member.
  - Gửi tin nhắn văn bản, hình ảnh, video. Đánh dấu đã đọc.
- **Tìm kiếm (Search):** Tìm kiếm bài đăng, người dùng theo hashtag hoặc từ khóa.
- **Đa phương tiện (Media):** Upload ảnh, upload video (xử lý qua queue).
- **Thông báo (Notification):** Gửi thông báo khi có người tương tác, nhắn tin (Real-time).

### 6. Functional Requirements (Yêu cầu chức năng)

#### 6.1. Quản lý Tài khoản & Định danh

- **FR1.1:** Người dùng có thể đăng ký tài khoản mới bằng email. Hệ thống sẽ gửi email chứa `EmailVerifyToken`.
- **FR1.2:** Người dùng có thể đăng nhập bằng email và mật khẩu, hệ thống trả về `Access Token` và `Refresh Token`.
- **FR1.3:** Người dùng có thể yêu cầu đổi mật khẩu. Hệ thống gửi email chứa `ForgotPasswordToken`.
- **FR1.4:** Hệ thống phải duy trì trạng thái đăng nhập bảo mật và hỗ trợ cấp lại token qua API Refresh Token.

#### 6.2. Quản lý Hồ sơ và Mạng lưới

- **FR2.1:** Người dùng có thể cập nhật thông tin cá nhân (tên, tiểu sử, vị trí, ảnh đại diện, ảnh bìa).
- **FR2.2:** Người dùng có thể Follow một người khác. Trạng thái `is_mutual` tự động được tính toán nếu cả hai đều theo dõi nhau.
- **FR2.3:** Người dùng có thể Unfollow.

#### 6.3. Đăng bài và Tương tác (Tweet)

- **FR3.1:** Người dùng tạo được Tweet chứa nội dung chữ, hashtag, mention, và danh sách Media (ảnh/video).
- **FR3.2:** Tweet có phân loại `TweetType` (Tweet gốc, Retweet, Comment, QuoteTweet).
- **FR3.3:** Có thể giới hạn đối tượng xem Tweet dựa vào `TweetAudience` (Everyone, TwitterCircle).
- **FR3.4:** Người dùng có thể Like, Unlike, Bookmark, Unbookmark một Tweet.
- **FR3.5:** Hệ thống phải ghi nhận lượng lượt xem (views) phân biệt giữa guest và user.

#### 6.4. Nhắn tin (Messaging)

- **FR4.1:** Hỗ trợ nhắn tin trực tiếp 1-1. Hệ thống chỉ lưu một document Conversation cho cặp 2 người dùng.
- **FR4.2:** Nhắn tin nhóm: hỗ trợ thêm nhiều thành viên, phân quyền `admin`/`member`, cài đặt `admin_only_messaging`.
- **FR4.3:** Tin nhắn (Message) hỗ trợ nhiều loại nội dung: văn bản, ảnh, video, file.
- **FR4.4:** Có tính năng hiển thị "preview tin nhắn cuối cùng" và lưu trữ mảng `read_by` để biết ai đã xem.

#### 6.5. Đa phương tiện & Xử lý nền

- **FR5.1:** Hỗ trợ tải lên ảnh. Ảnh tải lên có thể được tối ưu định dạng/kích thước bằng thư viện Sharp trước khi lưu trữ (hoặc upload lên Cloudinary).
- **FR5.2:** Hỗ trợ tải lên Video. Việc xử lý video (convert, nén, streaming chuẩn HLS nếu có) được đưa vào hàng đợi `BullMQ` để không chặn main thread.

#### 6.6. Tìm kiếm và Khám phá

- **FR6.1:** Cho phép tìm kiếm bằng từ khóa. Các thẻ hashtag tự động được tạo và liên kết khi người dùng post bài.

### 7. Non-functional Requirements (Yêu cầu phi chức năng)

#### 7.1. Hiệu suất (Performance)

- Hệ thống hỗ trợ xử lý hàng ngàn kết nối WebSocket đồng thời qua `socket.io`.
- Các request xử lý đa phương tiện phải được đẩy vào message queue (BullMQ), trả về kết quả `pending` cho client thay vì buộc client chờ đến khi xử lý xong video.
- Redis được sử dụng để cache dữ liệu có tần suất đọc cao.

#### 7.2. Bảo mật (Security)

- Toàn bộ mật khẩu được băm bằng `bcrypt` trước khi lưu vào cơ sở dữ liệu.
- Mọi endpoint yêu cầu xác thực đều phải kiểm tra tính hợp lệ của `Access Token` (JWT).
- `helmet` được áp dụng để bảo vệ chống lại các lỗ hổng web phổ biến (XSS, Clickjacking).
- Cấu hình `express-rate-limit` để giới hạn số lượt request từ một IP nhằm chống tấn công Brute-force/DDoS.

#### 7.3. Tính bảo trì & Mở rộng (Maintainability & Scalability)

- Codebase được viết bằng TypeScript với các Type Interface định nghĩa rõ ràng (đảm bảo type safety).
- Cấu trúc thư mục dạng Modular (`src/modules/*`), mỗi module độc lập với logic riêng (auth, user, tweet, media, etc.).
- Cơ chế Queue (Redis + BullMQ) cho phép hệ thống dễ dàng mở rộng theo chiều ngang (scale out worker để xử lý video/email).
- Sử dụng ESLint, Prettier để chuẩn hóa format code.

#### 7.4. Giao diện tích hợp

- Backend cung cấp Swagger API Docs giúp Frontend Developer có thể theo dõi và tương tác dễ dàng trong quá trình phát triển (tại các môi trường dev/staging).
