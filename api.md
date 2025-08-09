# Auth API

- `POST /api/auth/register` – Đăng ký tài khoản + gửi email xác thực luôn
- `POST /api/auth/login` – Đăng nhập
- `GET /api/auth/oauth/google` - Đăng nhập với google
- `POST /api/auth/logout` - Đăng xuất
- `POST /api/auth/refresh-token` - Cấp lại access token
- `POST /api/auth/verify-email` - Xác thực email verify token
- `POST /api/auth/resend-verify-email` - Gửi lại link xác nhận đăng kí
- `POST /api/auth/forgot-password` - Tạo token và gửi link xác thực tới email tài khoản muốn đổi mật khẩu
- `POST /api/auth/verify-forgot-password` - Xác thực token mà người dùng click từ link được gửi
- `POST /api/auth/reset-password` - Xác thực token và đổi mật khẩu mới
- `PATCH /api/auth/change-password` - Đổi mật khẩu

# User API

- `GET /api/users/me` - Lấy thông tin user hiện tại
- `GET /api/users/:username` - Lấy thông tin user qua username
- `PATCH /api/users/me` - Cập nhật thông tin user hiện tại
- `POST /api/users/:username/block` - Chặn một user
- `DELETE /api/users/:user_id/block/:blocked_id` - Bỏ chặn một user
- `GET /api/blocked-users/:blocker_id` - Lấy danh sách người dùng bị chặn
- `POST /api/users/:username/follow` - Follow một ai đó
- `DELETE /api/users/:username/unfollow` - Unfollow một ai đó
- `GET /api/users/:username/following` - Ds người username này đang follow
- `GET /api/users/:username/followers` - Ds người đang follow username này
- `GET /api/users/:username/follow-status` - Kiểm tra user hiện tại có follow user trên không

# Media

- `POST /api/media/upload` - Upload file (video, img, sticker)

# Search API

- `GET /api/search/users` - Tìm kiếm user
- `GET /api/search/posts` - Tìm kiếm bài viết

# Tweet API

- `POST /api/tweets` - Tạo tweet
- `DELETE /api/tweets/:tweet_id` - Xóa tweet
- `GET /api/tweets/feed` - Lấy danh sách bài viết
- `POST /api/tweets/:tweet_id/bookmarks` - Bookmark
- `DELETE /api/tweets/:tweet_id/bookmarks` - Unbookmark
- `POST /api/tweets/:tweet_id/likes` - Like
- `DELETE /api/tweets/:tweet_id/likes` - Unlike
- `GET /api/tweets/:tweet_id` -Lấy thông tin 1 tweet bao gồm cả số lượng like, comment, retweet, quote tweet
- `GET /api/tweets/:tweet_id/children` - Lấy thông tin tweet con của tweet_id kia

# Chat API

## Conversation API

### Dữ liệu để phân biết 1-1 và group sẽ được gửi trong body

- `POST /api/conversations` - Tạo cuộc trò chuyện 1-1, group
- `GET /api/conversations?query=:search_query&limit=:limit&offset=:offset` - Tìm kiếm cuộc hội thoại
- `GET /api/conversations/:id` - Lấy thông tin cuộc trò chuyện
- `PATCH /api/conversations/:id` - Cập nhật thông tin cuộc trò chuyện (đặt biệt danh, đổi tên nhóm)
- `GET /api/conversations?user_id=:user_id` - Lấy danh sách cuộc trò chuyện của người dùng (tùy chọn lấy 1-1 hoặc lấy group hoặc lấy cả trong req.body)
- `DELETE /api/conversations/:id` - Xóa cuộc trò chuyện (chỉ là xóa ở người đang đăng nhập, xóa phía client)
- `GET /api/conversations?user_id=:user_id` - Lấy danh sách cuộc trò chuyện của người dùng (thêm query nếu cần lấy 1-1 hoặc group)

## GroupConversation API

- `POST /api/conversations/:id/members` - Thêm thành viên vào nhóm
- `DELETE /api/conversations/:id/members/:user_id` - Xóa thành viên khỏi nhóm
- `DELETE /api/conversations/:id?action=destroy_group` - Xóa nhóm (chỉ người tạo nhóm có quyền)
- `GET /api/conversations/:id/members` - Lấy ds thành viên nhóm
- `DELETE /api/conversations/:id/members/self` - Rời nhóm chủ động

## Message API

- `POST /api/messages` - Gửi tin nhắn
- `PATCH /api/messages/:id/recall` - Thu hồi tin nhắn (nếu người thu hồi là người gửi thì xóa ở tất cả còn người thu hồi không phải người gửi thì chỉ là xóa tin nhắn phía người đó)
- `PATCH /api/messages/:id/read` - Đánh dấu tin nhắn đã đọc
- `GET /api/messages/conversation/:conversation_id` - Lấy tin nhắn trong cuộc trò chuyện (thêm query để kìm kiếm)
- `GET /api/messages?conversation_id=:conversation_id&query=:search_query&limit=:limit&offset=:offset` - Tìm kiếm tin nhắn
- `POST /api/messages/:id/reactions` - Thêm, thay đổi emoji
- `DELETE /api/messages/:id/reactions` - Gỡ emoji
- `GET /api/messages/:id/reactions` - Xem ds emoji
- `PATCH /api/messages/:id` - Chỉnh sửa tin nhắn

# Bổ sung

- Bật tắt thông báo
- Ghim cuộc trò chuyện
- Chuyển tiếp tin nhắn
