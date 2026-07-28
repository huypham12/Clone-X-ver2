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
- `GET /profile/:username`: Lấy thông tin hồ sơ công khai. Khi có đăng nhập, response có `is_blocked` (người gọi đã chặn profile) và `is_blocked_by_user` (profile đã chặn người gọi).
- `PATCH /me`: Cập nhật thông tin cá nhân (ảnh đại diện, tiểu sử,...).
- `POST /:blocked_user_id/block`: Chặn một người dùng; cả hai chiều không thể gửi direct message mới, lịch sử cũ vẫn được giữ. Cặp block có unique index và được ghi bằng atomic upsert để không tạo bản ghi trùng khi request đồng thời.
- `DELETE /:blocked_user_id/block`: Bỏ chặn một người dùng; direct message chỉ hoạt động lại nếu chiều còn lại cũng không có block. Server xóa toàn bộ bản ghi trùng cũ của đúng cặp này nếu dữ liệu legacy còn sót.
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
- `GET /groups/search?q=...&cursor=...&limit=10`: Tìm theo tên trong các group mà người gọi vẫn là thành viên, bao gồm group người gọi đã ẩn; trả cursor và tối đa 20 kết quả mỗi trang.
- `POST /direct/:receiver_id`: Mở hoặc tạo một hội thoại nhắn tin trực tiếp 1-1; trả `403` và không tạo/mở lại hội thoại nếu có block theo bất kỳ chiều nào.
- `POST /group`: Tạo một hội thoại nhóm (Group Conversation).
- `DELETE /:conversation_id`: Ẩn hội thoại khỏi hộp thư của người gọi. Thao tác này không xóa lịch sử phía thành viên khác; tin nhắn mới không tự làm hội thoại xuất hiện lại.
- `POST /:conversation_id/unhide`: Chủ động đưa hội thoại trở lại hộp thư; yêu cầu membership và chỉ `$pull` người gọi khỏi `hidden_by`.
- `PATCH /:conversation_id`: Cập nhật tên/avatar nhóm; chỉ member có role `admin` được phép gọi.
- `GET /:conversation_id/members`: Lấy danh sách thành viên trong nhóm; yêu cầu người gọi vẫn là member và response không chứa thông tin user nhạy cảm.
- `POST /:conversation_id/members`: Một member hiện tại thêm những user mà chính họ đang follow vào nhóm. Input không được lặp ID; backend kiểm tra membership + following và thêm toàn bộ danh sách bằng một update pipeline nguyên tử so sánh theo `members.user_id`, nên không có trạng thái thành công một phần hoặc member trùng khi request đồng thời. Event membership chỉ đồng bộ cache/realtime; chưa tạo system message/notification.
- `DELETE /:conversation_id/members/:user_id`: Admin xóa một member khác. Admin không được tự xóa qua route này và phải dùng route leave.
- `DELETE /:conversation_id/leave`: Member tự rời nhóm. Sole admin nhận `409 GROUP_SOLE_ADMIN_CANNOT_LEAVE` nếu nhóm vẫn còn member khác; hiện chưa có cơ chế chuyển quyền admin.
- `POST /:conversation_id/pin`: Ghim một hội thoại lên đầu danh sách.
- `DELETE /:conversation_id/pin`: Bỏ ghim một hội thoại.
- `GET /:conversation_id/messages`: Lấy danh sách message còn hiệu lực với người gọi. Message đã delete-for-me và status `deleted` legacy bị loại trước phân trang; `deleted_by` là state private và không được trả trong REST/socket response. Cache không chứng minh được còn đủ trang visible sẽ fallback MongoDB. Mỗi message còn lại có `medias_info`, `sender_info` public và `reply_to` compact hoặc `null`.
- `GET /:conversation_id/messages/:message_id/context?before=20&after=20`: Lấy cửa sổ tối đa 50 tin cũ và 50 tin mới quanh một message còn visible với người gọi; message đã delete-for-me không thể làm target hoặc xuất hiện trong cửa sổ.
- `GET /:conversation_id/search`: Tìm kiếm các message `sent` còn visible với người gọi; kết quả có `sender_info/reply_to` đã hydrate.
- `GET /:conversation_id/media`: Lấy message `sent` còn visible có ảnh/video/audio; mỗi message trả metadata media `ready`, `sender_info` public và `reply_to` compact.
- `POST /:conversation_id/read`: Đánh dấu đã đọc các tin nhắn mới trong hội thoại.
- `POST /messages/:message_id/revoke`: Sender còn là thành viên conversation được thu hồi message trạng thái `sent` cho mọi người. Mutation nguyên tử xóa content/media/reaction/reply target khỏi document, giữ tombstone và tính lại sidebar preview nếu đây là message cuối.
- `DELETE /messages/:message_id`: Mọi current member đang nhìn thấy message `sent` có thể xóa chỉ phía mình. Backend dùng transaction để `$addToSet` actor vào `deleted_by` và recompute `last_message_overrides` của actor cùng lúc; status/content và preview của member khác không đổi.
- `PATCH /messages/:message_id`: Chỉnh sửa nội dung tin nhắn đã gửi.
- `POST /messages/:message_id/react`: Current member thả hoặc đổi reaction trên message `sent` còn visible. Body strict chỉ nhận đúng một Unicode emoji hợp lệ, tối đa 64 UTF-16 code units; update pipeline nguyên tử bảo đảm mỗi user tối đa một reaction và trả reaction list/summary mới. Sáu emoji `👍 ❤️ 😂 😮 😢 😡` chỉ là gợi ý nhanh của frontend, không phải allowlist backend.
- `DELETE /messages/:message_id/react`: Current member gỡ reaction của chính mình khỏi message `sent` còn visible bằng update nguyên tử; response trả reaction list/summary mới.
- `GET /messages/:message_id/reactions`: Current member lấy danh sách reaction và public identity của user trên message `sent` còn visible; outsider, revoked hoặc delete-for-me bị từ chối.
- `POST /messages/:message_id/forward`: Chuyển tiếp message trạng thái `sent`; người gọi phải là thành viên của conversation nguồn và mọi conversation đích.
- `POST /:conversation_id/mute`: Tắt thông báo với body `{ type, duration_hours? }`; duration hỗ trợ 1, 8, 24 giờ hoặc bỏ trống để mute vô thời hạn.
- `DELETE /:conversation_id/mute?type=direct|group`: Bật lại thông báo cho hội thoại đã tắt.

### Socket conversation

- `@conversation:send`: Với direct conversation, server kiểm tra block hai chiều trước khi đọc media, ghi message, cập nhật conversation/Redis, broadcast hoặc tạo notification. Payload có thể chứa `reply_to_message_id`; target phải là message `sent` trong cùng conversation. Client có thể truyền acknowledgement callback; server trả `{ success: true, message_id }` sau khi message đã được lưu, cập nhật cache và broadcast, hoặc `{ success: false, error }` nếu bị từ chối. Frontend chỉ xóa draft/media sau acknowledgement thành công.
- `@conversation:receive`: Message mới được gửi tới personal rooms của member và có cùng contract HTTP, bao gồm `medias_info`, `sender_info` public và `reply_to` compact; Redis lưu chính payload đã hydrate này.
- `@message:revoked`, `@message:reaction-updated`: Phát tới personal rooms của các member sau mutation thành công. Reaction event mang `conversation_id`, `message_id`, reaction list và summary có thẩm quyền. `@message:deleted-for-me` chỉ phát tới personal room của actor để đồng bộ tab/device của họ; member khác không nhận event. Cache `chat:messages:<conversation_id>` bị xóa trước khi emit.
- Với group send, server kiểm tra lại membership ngay trước insert và tải lại danh sách member ngay trước broadcast/notification để người vừa bị remove không tiếp tục nằm trong recipients đã chụp trước đó. Forward cũng kiểm tra lại source/target membership ngay trước khi ghi.
- `@conversation:error`: Lỗi nghiệp vụ có payload `{ code, conversation_id, message }`. `DIRECT_MESSAGE_BLOCKED` cho biết direct message bị chặn hai chiều; `REPLY_MESSAGE_UNAVAILABLE` cho biết reply target không tồn tại, khác conversation hoặc không còn ở trạng thái `sent`. Frontend không cần parse chuỗi `message`.
- `@user:block-status-changed`: Gửi tới personal room của cả hai user sau khi block/unblock thành công, payload `{ user_ids: string[] }`; client phải invalidate/refetch profile để lấy trạng thái hai chiều có thẩm quyền từ server.
- `@conversation:group-updated`: Gửi tới personal rooms của các member cũ/mới liên quan sau khi đổi thông tin hoặc add/remove/leave, payload `{ conversation_id, change_type, actor_id, affected_user_ids }`. Sau mutation membership, server xóa ngay cache legacy `conv_members:<conversation_id>` trước khi emit.
- Forward vào direct conversation cũng bị từ chối toàn bộ trước khi ghi nếu một target direct có block. Typing direct không được chuyển tới người còn lại khi có block.

HTTP error response có trường optional `code`. Các lỗi group ổn định hiện có: `GROUP_ADMIN_CANNOT_REMOVE_SELF` và `GROUP_SOLE_ADMIN_CANNOT_LEAVE`; frontend không cần parse `message`.

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
