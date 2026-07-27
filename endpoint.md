# Tổng hợp API Endpoints của hệ thống X-Clone

Dưới đây là danh sách tất cả các API Endpoints được trích xuất từ mã nguồn các route, phân chia theo từng module. *(Ghi chú: Prefix URL có thể thay đổi tùy thuộc vào file `app.ts` hoặc `index.ts`, ví dụ `/api/users`, `/api/tweets`... ở đây chỉ liệt kê các path bên trong module router)*.

## 1. Auth Module (`/auth`)
*Chịu trách nhiệm xác thực, phân quyền và quản lý thông tin bảo mật.*
- `POST /register`: Đăng ký tài khoản người dùng mới.
- `POST /login`: Đăng nhập vào hệ thống, trả về `AccessToken` và `RefreshToken`.
- `POST /logout`: Đăng xuất, vô hiệu hóa `RefreshToken`.
- `POST /refresh-token`: Cấp lại `AccessToken` mới khi token cũ hết hạn.
- `POST /resend-verify-email`: Gửi lại email chứa mã xác thực tài khoản.
- `POST /verify-email`: Xác thực địa chỉ email bằng token.
- `POST /forgot-password`: Gửi yêu cầu thiết lập lại mật khẩu, nhận email khôi phục.
- `POST /verify-forgot-password`: Xác thực tính hợp lệ của token quên mật khẩu.
- `POST /reset-password`: Đặt lại mật khẩu mới khi quên.
- `PATCH /change-password`: Thay đổi mật khẩu khi đang đăng nhập.

## 2. User Module (`/users`)
*Quản lý thông tin hồ sơ và mạng lưới theo dõi (Follow/Block).*
- `GET /me`: Lấy thông tin cá nhân của người dùng hiện tại.
- `GET /profile/:username`: Lấy thông tin hồ sơ công khai của một người dùng dựa theo username.
- `PATCH /me`: Cập nhật thông tin cá nhân (ảnh đại diện, tiểu sử,...).
- `POST /:blocked_user_id/block`: Chặn một người dùng.
- `DELETE /:blocked_user_id/block`: Bỏ chặn một người dùng.
- `GET /blocked-users`: Lấy danh sách các người dùng đã bị chặn.
- `POST /:followed_user_id/follow`: Bắt đầu theo dõi một người dùng.
- `DELETE /:followed_user_id/follow`: Bỏ theo dõi một người dùng.
- `GET /:target_user_id/followers`: Lấy danh sách những người theo dõi người dùng này (Followers).
- `GET /:target_user_id/following`: Lấy danh sách những người mà người dùng này đang theo dõi (Following).
- `GET /:username/tweets`: Lấy danh sách các bài viết (Timeline) của người dùng.
- `GET /:username/replies`: Lấy danh sách các bình luận (Replies) của người dùng.
- `GET /:username/likes`: Lấy danh sách các bài viết đã thích (Likes) của người dùng.
- `GET /:username/media`: Lấy danh sách các ảnh/video (Media) của người dùng.

## 3. Tweet Module (`/tweets`)
*Quản lý các thao tác liên quan đến đăng bài viết (Tweet) và các hoạt động tương tác.*
- `GET /`: Lấy danh sách News Feed (Các bài viết mới của người mình theo dõi hoặc ngẫu nhiên).
- `POST /`: Tạo một Tweet mới.
- `GET /:tweet_id`: Lấy thông tin chi tiết của một Tweet.
- `GET /:tweet_id/children`: Lấy danh sách các Tweet con (Bao gồm comment, quote tweet, retweet) của một Tweet.
- `POST /:tweet_id/like`: Thích (Like) một Tweet.
- `DELETE /:tweet_id/like`: Bỏ thích (Unlike) một Tweet.
- `GET /:tweet_id/likes`: Lấy danh sách những người dùng đã thích một Tweet cụ thể.
- `GET /bookmarks`: Lấy danh sách các Tweet đã lưu (Bookmarks) của bản thân.
- `POST /:tweet_id/bookmark`: Lưu (Bookmark) một Tweet.
- `DELETE /:tweet_id/bookmark`: Bỏ lưu (Unbookmark) một Tweet.
- `DELETE /:tweet_id`: Xóa một Tweet (chỉ chủ sở hữu mới có quyền xóa).

## 4. Conversation Module (`/conversations`)
*Quản lý tính năng trò chuyện, bao gồm Chat 1-1 và Chat Group, cùng với tin nhắn.*
Các endpoint có `conversation_id` chỉ cho phép thành viên của hội thoại truy cập hoặc thay đổi dữ liệu; người dùng đã xác thực nhưng không phải thành viên nhận `403 Forbidden`.
- `GET /`: Lấy danh sách các hội thoại (Conversations) hiện có của người dùng.
- `POST /direct/:receiver_id`: Mở hoặc tạo một hội thoại nhắn tin trực tiếp 1-1 với người dùng khác.
- `POST /group`: Tạo một hội thoại nhóm (Group Conversation).
- `DELETE /:conversation_id`: Xóa toàn bộ hội thoại.
- `PATCH /:conversation_id`: Cập nhật thông tin nhóm (đổi tên nhóm, thay đổi ảnh đại diện nhóm) hoặc đổi biệt danh (nickname).
- `GET /:conversation_id/members`: Lấy danh sách thành viên trong nhóm.
- `POST /:conversation_id/members`: Thêm thành viên mới vào nhóm.
- `DELETE /:conversation_id/members/:user_id`: Kích/Xóa một thành viên khỏi nhóm (dành cho trưởng nhóm).
- `DELETE /:conversation_id/leave`: Rời khỏi nhóm chat (tự chủ động rời).
- `POST /:conversation_id/pin`: Ghim một hội thoại lên đầu danh sách.
- `DELETE /:conversation_id/pin`: Bỏ ghim một hội thoại.
- `GET /:conversation_id/messages`: Lấy danh sách các tin nhắn trong một hội thoại, kèm `medias_info` của message.
- `GET /:conversation_id/messages/:message_id/context?before=20&after=20`: Lấy cửa sổ tối đa 50 tin cũ và 50 tin mới quanh một message còn hiệu lực để nhảy tới đúng vị trí; yêu cầu người gọi là thành viên conversation.
- `GET /:conversation_id/search`: Tìm kiếm các tin nhắn trạng thái `sent` bên trong một hội thoại bằng từ khóa.
- `GET /:conversation_id/media`: Lấy danh sách message còn hiệu lực có ảnh/video/audio; mỗi message trả sẵn metadata media trạng thái `ready` trong `medias_info`.
- `POST /:conversation_id/read`: Đánh dấu đã đọc các tin nhắn mới trong hội thoại.
- `POST /messages/:message_id/revoke`: Thu hồi (gỡ bỏ đối với mọi người) một tin nhắn.
- `DELETE /messages/:message_id`: Xóa tin nhắn (chỉ gỡ bỏ từ phía người xóa).
- `PATCH /messages/:message_id`: Chỉnh sửa nội dung tin nhắn đã gửi.
- `POST /messages/:message_id/react`: Thả cảm xúc (React) vào một tin nhắn cụ thể.
- `DELETE /messages/:message_id/react`: Gỡ bỏ cảm xúc (Reaction) đã thả khỏi tin nhắn.
- `GET /messages/:message_id/reactions`: Lấy danh sách chi tiết những người đã thả cảm xúc vào tin nhắn này.
- `POST /messages/:message_id/forward`: Chuyển tiếp message trạng thái `sent`; người gọi phải là thành viên của conversation nguồn và mọi conversation đích.
- `POST /:conversation_id/mute`: Tắt thông báo với body `{ type, duration_hours? }`; duration hỗ trợ 1, 8, 24 giờ hoặc bỏ trống để mute vô thời hạn.
- `DELETE /:conversation_id/mute?type=direct|group`: Bật lại thông báo cho hội thoại đã tắt.

## 5. Search Module (`/search`)
*Hệ thống tìm kiếm chung.*
- `GET /users`: Tìm kiếm người dùng bằng từ khóa.
- `GET /tweets`: Tìm kiếm Tweet bằng từ khóa.
- `GET /hashtags`: Tìm kiếm và trả về danh sách các Hashtag thịnh hành/liên quan.
- `GET /hashtags/:tag/tweets`: Lấy danh sách các Tweet chứa một hashtag cụ thể.
- `GET /history`: Lấy lịch sử tìm kiếm gần đây của người dùng.
- `DELETE /history`: Xóa lịch sử tìm kiếm của người dùng.

## 6. Notification Module (`/notifications`)
*Trung tâm thông báo (Notification center).*
- `GET /`: Lấy danh sách thông báo của người dùng.
- `POST /read-all`: Đánh dấu toàn bộ thông báo là "đã đọc".
- `POST /:id/read`: Đánh dấu một thông báo cụ thể là "đã đọc".

## 7. Media Module (`/media`)
*Xử lý tải lên đa phương tiện.*
- `POST /upload-image`: Upload tệp hình ảnh.
- `POST /upload-video`: Upload tệp video (Sẽ đưa vào queue chờ xử lý).
- `POST /upload-audio`: Upload tệp âm thanh (Voice message, audio).
- `GET /:media_id`: Lấy thông tin chi tiết về một file media.
- `DELETE /:media_id`: Xóa file media khỏi hệ thống lưu trữ (Cloudinary và Database).
