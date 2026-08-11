# Tổng hợp API Endpoints của hệ thống X-Clone

Dưới đây là danh sách tất cả các API Endpoints được trích xuất từ mã nguồn các route, phân chia theo từng module. _(Ghi chú: Prefix URL có thể thay đổi tùy thuộc vào file `app.ts` hoặc `index.ts`, ví dụ `/api/users`, `/api/tweets`... ở đây chỉ liệt kê các path bên trong module router)_.

## 0. Health (`/health`)

Hai endpoint public, không yêu cầu auth và không đi qua global rate limiter:

- `GET /live`: Trả `200` khi process còn phản hồi; không gọi MongoDB hoặc Redis.
- `GET /ready`: Ping MongoDB, Redis cache và BullMQ Redis với timeout ngắn. Trả `200` khi tất cả dependency sẵn sàng, ngược lại trả `503`. Response chỉ nêu trạng thái `mongodb`/`redis`, không chứa URI, database name hoặc error detail.

## 1. Auth Module (`/auth`)

_Chịu trách nhiệm xác thực, phân quyền và quản lý thông tin bảo mật._

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

_Quản lý thông tin hồ sơ và mạng lưới theo dõi (Follow/Block)._

- `GET /me`: Lấy thông tin cá nhân của người dùng hiện tại.
- `GET /profile/:username`: Lấy thông tin hồ sơ công khai. Khi có đăng nhập, response có `is_blocked` (người gọi đã chặn profile) và `is_blocked_by_user` (profile đã chặn người gọi).
- `PATCH /me`: Cập nhật thông tin cá nhân (ảnh đại diện, tiểu sử,...).
- `POST /:blocked_user_id/block`: Chặn một người dùng; cả hai chiều không thể gửi direct message mới, lịch sử cũ vẫn được giữ. Cặp block có unique index và được ghi bằng atomic upsert để không tạo bản ghi trùng khi request đồng thời.
- `DELETE /:blocked_user_id/block`: Bỏ chặn một người dùng; direct message chỉ hoạt động lại nếu chiều còn lại cũng không có block. Server xóa toàn bộ bản ghi trùng cũ của đúng cặp này nếu dữ liệu legacy còn sót.
- `GET /blocked-users`: Lấy danh sách các người dùng đã bị chặn.
- `POST /:followed_user_id/follow`: Bắt đầu theo dõi một người dùng. ID sai định dạng hoặc tự follow trả `400`, block hai chiều trả `403`, user đích không tồn tại trả `404`, relation đã tồn tại hoặc request đồng thời thua unique race trả `409`. Relation và hai counter được commit nguyên tử. Response `200` giữ `{ statusCode, message, data: null }`.
- `DELETE /:followed_user_id/follow`: Bỏ theo dõi một người dùng. Relation và hai counter được commit nguyên tử; relation không tồn tại trả `400`. Notification Follow đã giao trước đó được giữ, còn event chưa xử lý sẽ bị suppress sau khi worker recheck relation.
- `PATCH /:followed_user_id/follow-notification-preferences`: Cập nhật opt-in cho relation do caller sở hữu, body strict `{ "posts": boolean }`. Relation không tồn tại trả `404`; follow mới mặc định `posts=false` và unfollow xóa luôn preference.
- `GET /:target_user_id/followers`: Lấy danh sách những người theo dõi người dùng này (Followers).
- `GET /:target_user_id/following`: Lấy danh sách những người mà người dùng này đang theo dõi (Following).
- `GET /:username/tweets`: Lấy danh sách các bài viết (Timeline) của người dùng.
- `GET /:username/replies`: Lấy danh sách các bình luận (Replies) của người dùng.
- `GET /:username/likes`: Lấy danh sách các bài viết đã thích (Likes) của người dùng.
- `GET /:username/media`: Lấy danh sách các ảnh/video (Media) của người dùng.

## 3. Tweet Module (`/tweets`)

_Quản lý các thao tác liên quan đến đăng bài viết (Tweet) và các hoạt động tương tác._

- `GET /`: Lấy danh sách News Feed (Các bài viết mới của người mình theo dõi hoặc ngẫu nhiên).
- `POST /`: Tạo Tweet mới. Explicit mention ID được normalize/dedupe với username `@...` trong content; user không tồn tại và self mention bị loại. Khi notification outbox path được bật, Tweet, parent counter, news feed và event notification được commit cùng transaction; Reply/Quote ưu tiên hơn Mention cho parent owner. Tweet gốc public còn tạo fan-out notification bất đồng bộ theo batch 500 cho các follow relation đã opt-in; request không chờ fan-out.
- `PATCH /:tweet_id`: Sửa audience/content/hashtags/mentions/medias theo contract cũ. `mentions` là field PATCH optional: bỏ qua field này sẽ giữ nguyên danh sách mention đã lưu, kể cả khi chỉ sửa `content`; muốn thêm hoặc bỏ mention, client phải gửi toàn bộ danh sách explicit mention mong muốn. Khi `mentions` được gửi, backend dedupe danh sách đó với username `@...` trong content hiện tại; nếu notification outbox path được bật, mention mới tạo notification idempotent, mention bị bỏ được invalidate và biến khỏi notification REST feed.
- `GET /:tweet_id`: Lấy thông tin chi tiết của một Tweet.
- `GET /:tweet_id/children`: Lấy danh sách các Tweet con (Bao gồm comment, quote tweet, retweet) của một Tweet.
- `POST /:tweet_id/like`: Thích (Like) một Tweet. Relation và `like_count` được ghi nguyên tử; khi social aggregation flag bật, notification Like được xử lý bất đồng bộ và gom theo tweet. Tweet không tồn tại trả `404`.
- `DELETE /:tweet_id/like`: Bỏ thích (Unlike) một Tweet. Chỉ event undo của relation thực sự bị xóa mới được phát; gọi lặp không giảm counter/aggregate lần hai.
- `GET /:tweet_id/likes`: Lấy danh sách những người dùng đã thích một Tweet cụ thể.
- `GET /bookmarks`: Lấy danh sách các Tweet đã lưu (Bookmarks) của bản thân.
- `POST /:tweet_id/bookmark`: Lưu (Bookmark) một Tweet.
- `DELETE /:tweet_id/bookmark`: Bỏ lưu (Unbookmark) một Tweet.
- `DELETE /:tweet_id/retweet`: Undo retweet của caller. Relation, parent counter, news feed và undo event được commit cùng transaction; gọi lặp là no-op.
- `DELETE /:tweet_id`: Xóa một Tweet (chỉ chủ sở hữu mới có quyền xóa).

Notification durable và các handler social/directed/group mặc định bật cho local. Có thể đặt `false` để rollback/debug: Follow dùng `NOTIFICATION_OUTBOX_ENABLED` + `NOTIFICATION_FOLLOW_OUTBOX_ENABLED`; Reply/Quote/Mention dùng global flag + `NOTIFICATION_TWEET_OUTBOX_ENABLED`; Like/Repost dùng global flag + `NOTIFICATION_SOCIAL_AGGREGATION_ENABLED`; Message Reply/Group Mention dùng global flag + `NOTIFICATION_MESSAGE_DIRECTED_ENABLED`; group system/direct notification dùng global flag + `NOTIFICATION_GROUP_MANAGEMENT_ENABLED`; tweet gốc opt-in dùng global flag + TweetCreated outbox + `NOTIFICATION_FOLLOWED_TWEET_ENABLED`. Generic `message` và `message_reaction` không thuộc durable Notification policy; reaction chỉ cập nhật Chat. Các flag không làm đổi REST request/response và không bật lại legacy writer.

## 4. Conversation Module (`/conversations`)

_Quản lý tính năng trò chuyện, bao gồm Chat 1-1 và Chat Group, cùng với tin nhắn._
Các endpoint có `conversation_id` chỉ cho phép thành viên của hội thoại truy cập hoặc thay đổi dữ liệu; người dùng đã xác thực nhưng không phải thành viên nhận `403 Forbidden`.

- `GET /`: Lấy danh sách các hội thoại hiện có của người dùng. Mỗi item bổ sung `unread_message_count`, `last_read_message_id`, `last_read_at`; các field cũ và thứ tự pin/thời gian giữ nguyên.
- `GET /unread-summary`: Trả `{ unread_conversation_count, total_unread_message_count, version, updated_at }`. Badge inbox dùng `unread_conversation_count`, không dùng tổng số message.
- `GET /groups/search?q=...&cursor=...&limit=10`: Tìm theo tên trong các group mà người gọi vẫn là thành viên, bao gồm group người gọi đã ẩn; trả cursor và tối đa 20 kết quả mỗi trang.
- `POST /direct/:receiver_id`: Mở hoặc tạo một hội thoại nhắn tin trực tiếp 1-1; trả `{ success, reopened_at, conversation }` với conversation đã normalize cho người gọi. Trả `403` và không tạo/mở lại hội thoại nếu có block theo bất kỳ chiều nào.
- `POST /group`: Tạo một hội thoại nhóm. Tổng số member, tính cả creator, không vượt `MAX_GROUP_MEMBERS` (mặc định `500`); vượt giới hạn trả `400 GROUP_MEMBER_LIMIT_EXCEEDED`. Khi group-management flag bật, group, read-state, system message và outbox direct notification cho member mới commit cùng transaction.
- `DELETE /:conversation_id`: Ẩn hội thoại khỏi hộp thư của người gọi. Thao tác này không xóa lịch sử phía thành viên khác; tin nhắn mới không tự làm hội thoại xuất hiện lại.
- `DELETE /:conversation_id/history`: Xóa lịch sử hiện tại chỉ phía người gọi bằng cutoff `_id`, đồng thời đưa unread conversation về 0 và ẩn/bỏ pin/bỏ mute hội thoại trong cùng transaction. Message/media không bị xóa vật lý và thành viên khác không bị ảnh hưởng. Người gọi có thể chủ động mở lại; nếu chưa mở, message mới đầu tiên sau cutoff sẽ tự khôi phục hội thoại như chat mới. Hide from inbox thuần túy vẫn không tự restore.
- `POST /:conversation_id/unhide`: Chủ động đưa hội thoại trở lại hộp thư; yêu cầu membership, chỉ `$pull` người gọi khỏi `hidden_by` và trả `{ success, reopened_at, conversation }` đã normalize để client mở ngay direct/group mà không chờ refetch danh sách.
- `PATCH /:conversation_id`: Cập nhật tên/avatar nhóm; chỉ member có role `admin` được phép gọi.
- `GET /:conversation_id/members`: Lấy danh sách thành viên trong nhóm; yêu cầu người gọi vẫn là member và response không chứa thông tin user nhạy cảm.
- `POST /:conversation_id/members`: Một member hiện tại thêm những user mà chính họ đang follow vào nhóm. Input không được lặp ID; backend kiểm tra membership + following và giới hạn `MAX_GROUP_MEMBERS` ngay trong update nguyên tử, nên request đồng thời không tạo member trùng hoặc vượt trần. Conflict do membership/limit đổi đồng thời trả `409 GROUP_MEMBER_LIMIT_CONFLICT`. Khi group-management flag bật, mỗi request có member mới tạo một system message và một `group_add` item cho từng member vừa thêm.
- `DELETE /:conversation_id/members/:user_id`: Admin xóa một member khác. Admin không được tự xóa qua route này và phải dùng route leave. Membership, read-state và global inbox summary của member bị xóa được cập nhật trong cùng transaction.
- `DELETE /:conversation_id/leave`: Member tự rời nhóm. Read-state của group được xóa và inbox summary được giảm trong cùng transaction. Sole admin nhận `409 GROUP_SOLE_ADMIN_CANNOT_LEAVE` nếu nhóm vẫn còn member khác và phải dùng route chuyển quyền bên dưới.
- `POST /:conversation_id/transfer-admin-and-leave`: Sole admin truyền `{ successor_user_id }` để chuyển role `admin` cho đúng một member hiện tại, tự rời nhóm và xóa unread state cũ trong cùng transaction. Route kiểm tra lại sole-admin + successor ngay lúc ghi; conflict trả `409 GROUP_ADMIN_TRANSFER_CONFLICT`, successor không hợp lệ trả `400 GROUP_ADMIN_SUCCESSOR_INVALID`.
- `POST /:conversation_id/admins/:user_id`: Admin hiện tại cấp role admin cho một member. Role, system message và outbox notification `admin_granted` commit cùng transaction; state đổi đồng thời trả `409 GROUP_ADMIN_GRANT_CONFLICT`.
- `DELETE /:conversation_id/admins/:user_id`: Admin hiện tại thu hồi role admin. Backend không cho mutation làm group còn member nhưng không còn admin; sole-admin/race trả `409 GROUP_ADMIN_REVOKE_CONFLICT`. Khi bật flag, affected user nhận `admin_revoked`.
- `POST /:conversation_id/pin`: Ghim một hội thoại lên đầu danh sách.
- `DELETE /:conversation_id/pin`: Bỏ ghim một hội thoại.
- `GET /:conversation_id/messages`: Lấy danh sách message còn hiệu lực với người gọi. Message đã delete-for-me và status `deleted` legacy bị loại trước phân trang; `deleted_by` là state private và không được trả trong REST/socket response. Cache không chứng minh được còn đủ trang visible sẽ fallback MongoDB. Mỗi message còn lại có `medias_info`, `sender_info` public và `reply_to` compact hoặc `null`.
- `GET /:conversation_id/messages/:message_id/context?before=20&after=20`: Lấy cửa sổ tối đa 50 tin cũ và 50 tin mới quanh một message còn visible với người gọi; message đã delete-for-me không thể làm target hoặc xuất hiện trong cửa sổ.
- `GET /:conversation_id/search`: Tìm kiếm các message `sent` còn visible với người gọi; kết quả có `sender_info/reply_to` đã hydrate.
- `GET /:conversation_id/media`: Lấy message `sent` còn visible có ảnh/video/audio; mỗi message trả metadata media `ready`, `sender_info` public và `reply_to` compact.
- `POST /:conversation_id/read`: Body `{ message_id?: string }`. Body rỗng mark read tới message visible mới nhất; có `message_id` chỉ tiến read position tới message đó, message commit sau vị trí này vẫn unread. Response bổ sung `last_read_message_id`, `last_read_at`, unread từng conversation, hai tổng inbox và `version`. Path mới không update `Message.read_by`.
- `POST /messages/:message_id/revoke`: Sender còn là thành viên conversation được thu hồi message trạng thái `sent` cho mọi người. Mutation nguyên tử xóa content/media/reaction/reply target khỏi document, giữ tombstone và tính lại sidebar preview nếu đây là message cuối.
- `DELETE /messages/:message_id`: Mọi current member đang nhìn thấy message `sent` có thể xóa chỉ phía mình. Backend dùng transaction để `$addToSet` actor vào `deleted_by` và recompute `last_message_overrides` của actor cùng lúc; status/content và preview của member khác không đổi.
- `PATCH /messages/:message_id`: Chỉnh sửa nội dung tin nhắn đã gửi.
- `POST /messages/:message_id/react`: Current member thả hoặc đổi reaction trên message `sent` còn visible. Body strict chỉ nhận đúng một Unicode emoji hợp lệ, tối đa 64 UTF-16 code units; reaction và outbox notification (khi bật flag) commit cùng transaction. Cùng emoji là no-op, không ghi/emit lại. Response reaction list/summary giữ nguyên. Sáu emoji `👍 ❤️ 😂 😮 😢 😡` chỉ là gợi ý nhanh của frontend, không phải allowlist backend.
- `DELETE /messages/:message_id/react`: Current member gỡ reaction của chính mình khỏi message `sent` còn visible; reaction và outbox commit cùng transaction. Không có reaction là no-op. Response reaction list/summary giữ nguyên.
- `GET /messages/:message_id/reactions`: Current member lấy danh sách reaction và public identity của user trên message `sent` còn visible; outsider, revoked hoặc delete-for-me bị từ chối.
- `POST /messages/:message_id/forward`: Chuyển tiếp message trạng thái `sent`; body `{ conversation_ids, client_operation_id? }`. Target ObjectId được canonicalize trước khi dedupe, toàn bộ source/target được validate và ghi trong một transaction. Khi có `client_operation_id`, retry dùng key dẫn xuất theo từng target canonical và không tạo/broadcast/tăng unread lần hai. Response legacy `{ success: true }` giữ nguyên.
- `POST /:conversation_id/mute`: Tắt thông báo với body `{ type, duration_hours? }`; duration hỗ trợ 1, 8, 24 giờ hoặc bỏ trống để mute vô thời hạn.
- `DELETE /:conversation_id/mute?type=direct|group`: Bật lại thông báo cho hội thoại đã tắt.

### Socket conversation

- `@conversation:send`: Payload bổ sung `client_message_id?: string` (1–256 ký tự) và `mention_user_ids?: string[]`. Explicit IDs được dedupe và chỉ current group member mới được lưu; backend cũng resolve `@username` trong text, bỏ self/nonmember. Message, conversation preview, `MessageCreated` outbox và unread state commit trong cùng transaction; cache/emit chỉ chạy sau commit. Retry cùng key và cùng payload trả lại `message_id` cũ; dùng lại key với content/media/reply/mention khác trả `409 CONFLICT`. Payload thiếu các field mới vẫn tương thích.
- `@conversation:receive`: Message mới được gửi tới personal rooms của current member và có cùng contract HTTP, bao gồm `medias_info`, `sender_info` public và `reply_to` compact; Redis lưu chính payload đã hydrate này. System message dùng cùng event và bổ sung `kind=system`, `system_event_type`, `affected_user_ids`, `context`; member đã rời/bị kick không nhận payload này.
- `@conversation:read`: Client gửi `{ conversation_id, message_id? }` kèm acknowledgement. Thành công trả conversation count, hai tổng inbox và `version`; lỗi trả `{ success: false, error }`.
- `@conversation:read-state`: Phát tới personal room của user khi unread tăng hoặc read acknowledgement commit. Payload `{ conversation_id, last_read_message_id, last_read_at, unread_message_count, unread_conversation_count, total_unread_message_count, version, updated_at }`; mọi tab/device của cùng user nhận cùng state.
- `@message:revoked`, `@message:reaction-updated`: Phát tới personal rooms của các member sau mutation thành công. Reaction event mang `conversation_id`, `message_id`, reaction list và summary có thẩm quyền; no-op react/unreact không emit lại. `@message:deleted-for-me` và `@conversation:history-cleared` chỉ phát tới personal room của actor để đồng bộ tab/device của họ; member khác không nhận event. Cache `chat:messages:<conversation_id>` bị xóa trước khi emit.
- Với group send, server kiểm tra lại membership ngay trước insert và tải lại danh sách member ngay trước broadcast/notification để người vừa bị remove không tiếp tục nằm trong recipients đã chụp trước đó. Forward cũng kiểm tra lại source/target membership ngay trước khi ghi.
- `@conversation:error`: Lỗi nghiệp vụ có payload `{ code, conversation_id, message }`. `DIRECT_MESSAGE_BLOCKED` cho biết direct message bị chặn hai chiều; `REPLY_MESSAGE_UNAVAILABLE` cho biết reply target không tồn tại, khác conversation hoặc không còn ở trạng thái `sent`. Frontend không cần parse chuỗi `message`.
- `@user:block-status-changed`: Gửi tới personal room của cả hai user sau khi block/unblock thành công, payload `{ user_ids: string[] }`; client phải invalidate/refetch profile để lấy trạng thái hai chiều có thẩm quyền từ server.
- `@conversation:group-updated`: Giữ payload `{ conversation_id, change_type, actor_id, affected_user_ids }`. Ngoài các value cũ, `change_type` có thêm `group_created`, `admin_granted`, `admin_revoked`; chuyển quyền vẫn dùng `admin_transferred`. Event remove/kick vẫn gửi tới affected user, còn `@conversation:receive` system message chỉ gửi current member. Sau mutation membership, server xóa cache legacy trước khi emit.
- Forward vào direct conversation cũng bị từ chối toàn bộ trước khi ghi nếu một target direct có block. Typing direct không được chuyển tới người còn lại khi có block.

HTTP error response có trường optional `code`. Các lỗi group ổn định hiện có: `GROUP_ADMIN_CANNOT_REMOVE_SELF`, `GROUP_SOLE_ADMIN_CANNOT_LEAVE`, `GROUP_ADMIN_SUCCESSOR_INVALID` và `GROUP_ADMIN_TRANSFER_CONFLICT`; frontend không cần parse `message`.

## 5. Search Module (`/search`)

_Hệ thống tìm kiếm chung._

- `GET /users`: Tìm kiếm người dùng bằng từ khóa.
- `GET /tweets`: Tìm kiếm Tweet bằng từ khóa.
- `GET /hashtags`: Tìm kiếm và trả về danh sách các Hashtag thịnh hành/liên quan.
- `GET /hashtags/:tag/tweets`: Lấy danh sách các Tweet chứa một hashtag cụ thể.
- `GET /history`: Lấy lịch sử tìm kiếm gần đây của người dùng.
- `DELETE /history`: Xóa lịch sử tìm kiếm của người dùng.

## 6. Notification Module (`/notifications`)

_Trung tâm thông báo (Notification center)._

- `GET /`: Lấy notification chưa bị invalidated theo tuple `{ created_at: -1, _id: -1 }`. Query `limit` là số nguyên `1..100`, mặc định `10`; `cursor` mới là chuỗi opaque từ `next_cursor`, đồng thời backend vẫn nhận cursor ObjectId 24-hex cũ nếu document đó thuộc caller. Response giữ `notifications`, `unreadCount`, `next_cursor`, `has_next_page` và bổ sung field schema v2, `actor_info`, `actor_infos_preview`, `target_info` đã giới hạn projection công khai. Nếu actor/target đã bị block, banned, xóa hoặc mất quyền xem trong lúc lifecycle cleanup chưa hoàn tất, backend đặt raw `sender_id`/`target_id` tương ứng thành `null`, lọc `actor_ids_preview`, trả `context={}` và bỏ các key dedup/aggregation của item đó.
- `GET /unread-count`: Trả `{ unreadCount, version, updated_at }` từ `NotificationState`, là nguồn runtime duy nhất của notification badge. Không có `countDocuments` fallback; môi trường local phải reset đồng thời notification/state/actor nếu baseline cũ không tương thích.
- `POST /read-all`: Đánh dấu notification chưa đọc/chưa invalidated tới cutoff của request, set `read_at`/`updated_at` và đóng aggregate window nếu có. Item mới hoặc reactivation sau cutoff vẫn unread nhờ unread-generation marker nội bộ; dữ liệu compatibility chưa có marker dùng tuple `{created_at, _id}`. Có thể gọi lặp lại; response `{ updatedCount, unreadCount, version }` và `updatedCount=0` nếu không có transition.
- `POST /:id/read`: Đánh dấu một notification thuộc caller là đã đọc. Có thể gọi lặp lại; response `{ success: true, unreadCount, version }`. Chỉ transition đầu tiên decrement unread state. ID sai định dạng trả `400`, ID không tồn tại hoặc thuộc user khác trả `404`.

Bốn endpoint dùng Bearer access token. Các field legacy `_id`, `recipient_id`, `sender_id`, `type`, `target_id`, `is_read`, `created_at` vẫn được giữ. `@notification:new` vẫn là raw notification object ở top-level. `@notification:updated` cập nhật aggregate còn actor; `@notification:removed` xóa cả aggregate rỗng và individual item bị invalidated bởi delete/revoke/delete-for-me/block. Tất cả emit sau commit; emit lỗi không rollback dữ liệu.

Khi message directed flag bật, message reply tạo `message_reply`, group mention tạo `message_mention`, mention thắng reply cho cùng recipient và cả hai dùng `target_type=MESSAGE`. Message thường/thành viên khác chỉ đi qua inbox unread + `@conversation:receive`; backend không tạo generic `message`. Message reaction chỉ cập nhật reaction state/`@message:reaction-updated`, không tạo `message_reaction`. Mute conversation không suppress directed in-app item. Durable feed và unread policy tự loại/invalidate hai type compatibility này.

Like/Repost và Message Reaction aggregate giữ nguyên `type`, `sender_id` và `target_id`; `sender_id` là actor gần nhất, `actor_count` là tổng actor edge trong active window và `actor_ids_preview` tối đa ba. Message Reaction dùng `target_type=MESSAGE`, context có emoji/conversation và một actor đổi emoji chỉ cập nhật edge, không tăng count. Mark-read đóng window; activity mới sau đó tạo notification mới thay vì kéo document cũ lên đầu feed. Undo/remove chỉ giảm đúng edge nguồn và invalidate aggregate khi count về 0; removal event đang chờ vẫn gỡ source edge nếu message bị revoke hoặc owner mất visibility trước lúc worker xử lý.

Lifecycle notification dùng outbox khi `NOTIFICATION_OUTBOX_ENABLED=true`: xóa tweet, chuyển tweet public sang audience hạn chế hoặc revoke message làm item trỏ target biến khỏi feed; delete-for-me chỉ xóa item của chính actor; block làm sạch individual item hai chiều và loại actor hai phía khỏi aggregate. Cleanup lớn chạy theo continuation tối đa 500 item/transaction. Unblock không khôi phục item cũ. Future event giữa hai user bị block và event có actor bị banned/deleted bị suppress; REST không hydrate hoặc trả raw ID của actor/target không còn hợp lệ. Retry lifecycle chỉ chuyển unread một lần. Trước khi bật v2 outbox phải reset đồng thời local `notifications`, `notificationActors`, `notificationStates`; startup từ chối notification legacy, actor/state mồ côi, notification thiếu state và active aggregate thiếu actor edge; backend không infer dữ liệu cũ.

## 7. Media Module (`/media`)

_Xử lý tải lên đa phương tiện._

- `POST /upload-image`: Upload tệp hình ảnh.
- `POST /upload-video`: Upload tệp video (Sẽ đưa vào queue chờ xử lý).
- `POST /upload-audio`: Upload tệp âm thanh (Voice message, audio).
- `GET /:media_id`: Lấy thông tin chi tiết về một file media.
- `DELETE /:media_id`: Xóa file media khỏi hệ thống lưu trữ (Cloudinary và Database).
