# Users

```ts
interface UserType {
  _id?: ObjectId
  name: string
  email: string
  date_of_birth: Date
  password: string
  created_at?: Date
  updated_at?: Date
  email_verify_token?: string
  forgot_password_token?: string
  verify?: UserVerifyStatus

  bio?: string
  location?: string
  website?: string
  username?: string
  avatar?: string
  cover_photo?: string
}
```

# Follows

```ts
interface FollowersType {
  _id?: ObjectId
  follow_id: ObjectId // ID của người theo dõi
  followed_id: ObjectId // ID của người được theo dõi
  status?: 'pending' | 'accepted' | 'blocked' // Trạng thái quan hệ
  created_at?: Date
  updated_at?: Date // Thời điểm cập nhật gần nhất
  is_mutual?: boolean // cần kiểm tra nếu user A theo dõi user B rồi thì khi user B theo dõi user A thì is_mutual sẽ là true, khi này sẽ hiển thị là bạn bè
}
```

# Hashtags

```ts
interface HashtagsType {
  _id?: ObjectId
  name: string
  created_at?: Date
}
```

# Refresh Token

```ts
interface RefreshTokenType {
  _id?: ObjectId
  token: string
  created_at?: Date
  user_id: ObjectId
  iat: number
  exp: number
}
```

# Tweets

```ts
interface TweetConstructor {
  _id?: ObjectId
  user_id: ObjectId // người sở hữu tweet
  type: TweetType // loại tweet
  audience: TweetAudience
  circle_id: ObjectId
  content: string
  parent_id: null | ObjectId //  chỉ null khi tweet gốc, một tweet có thể có nhiều tweet con nên cần parent_id để phân cấp
  hashtags: ObjectId[]
  mentions: ObjectId[]
  medias: Media[]
  guest_views?: number
  user_views?: number
  created_at?: Date
  updated_at?: Date
}
```

# Bookmarks

```ts
interface BookmarkType {
  _id?: ObjectId
  user_id: ObjectId
  tweet_id: ObjectId
  created_at?: Date
}
```

# Likes

```ts
interface Like {
  _id?: ObjectId
  user_id: ObjectId
  tweet_id: ObjectId
  created_at?: Date
}
```

# Direct Conversation

```ts
interface DirectConversationType {
  _id?: ObjectId
  user1_id: ObjectId // user1_id < user2_id để tránh tạo hai docs cho cùng 1 mess
  user2_id: ObjectId
  last_message_at: Date // cho phép nhanh chóng sắp xếp thứ tự của các message
  last_message_preview: Object // hiển thị preview trong khi đang load các cuộc trò chuyện
}
```

# Group Conversation

```ts
type MessagePreview = {
  sender_id: ObjectId
  content: string
  message_type: 'text' | 'image' | 'video' | 'file'
}

type GroupMember = {
  user_id: ObjectId
  role: 'admin' | 'member'
  joined_at: Date // Thời điểm tham gia nhóm
  is_muted?: boolean
  last_seen?: Date
}

interface GroupConversationType {
  _id: ObjectId
  name: string
  avatar_url?: string
  members: GroupMember[]
  created_by: ObjectId
  admin_only_messaging: boolean
  last_message_at: Date
  last_message_preview: MessagePreview
  created_at: Date
  updated_at: Date
}
```

# Messages

```ts
interface MessageType {
  _id: ObjectId
  conversation_id: ObjectId
  conversattion_type: Boolean // 0 là chat 1-1, 1 là chat group
  sender_id: ObjectId
  content: string
  media: Media[]
  send_at: Date
  read_by: ObjectId[] // những ai đã xem tin nhắn
}
```

# Các kiểu enum được sử dụng trong schema

```ts
enum UserVerifyStatus {
  Unverified, // chưa xác thực email, mặc định = 0
  Verified, // đã xác thực email
  Banned // bị khóa
}

enum TokenType {
  AccessToken,
  RefreshToken,
  ForgotPasswordToken,
  EmailVerifyToken
}

enum MediaType {
  Image,
  Video,
  Icon
}

enum TweetAudience {
  Everyone, // 0
  TwitterCircle // 1
}

enum TweetType {
  Tweet,
  Retweet,
  Comment,
  QuoteTweet
}
```
