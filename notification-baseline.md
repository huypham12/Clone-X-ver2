# Notification baseline trước Phase 1

Baseline được khóa trước khi sửa source để đối chiếu backward compatibility.

- MongoDB có 111 notification legacy tại thời điểm chụp; sample document có `_id`, `recipient_id`, `sender_id`, `type`, `target_id`, `is_read`, `created_at`.
- Index thực tế ban đầu chỉ có `_id_` và `recipient_id_1_created_at_-1`; index `recipient_id_1_is_read_1` bị thiếu.
- `GET /api/notifications` trả `notifications`, `unreadCount`, `next_cursor`, `has_next_page`. Zero item trả mảng rỗng/cursor null; one item với limit mặc định trả một item; implementation cũ dùng `notifications.length === limit`, nên exact page có thể báo còn trang sai.
- `POST /api/notifications/read-all` trả `{ updatedCount: number }`; `POST /api/notifications/:id/read` trả `{ success: boolean }`.
- `@notification:new` là raw notification legacy emit vào room user, không có wrapper hoặc unread count.
- Các event conversation liên quan giữ payload hiện hành: `@conversation:receive` là message đã hydrate; `@message:reaction-updated` có `conversation_id`, `message_id`, `reactions`, `summary`; `@conversation:group-updated` có `conversation_id`, `change_type`, `actor_id`, `affected_user_ids`.
- Worktree trước triển khai không có source modified; các tài liệu notification là file untracked và được giữ nguyên.
