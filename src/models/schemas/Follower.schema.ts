import { ObjectId } from 'mongodb'

export type FollowersType = {
  _id?: ObjectId
  follow_id: ObjectId // ID của người theo dõi
  followed_id: ObjectId // ID của người được theo dõi
  status?: 'pending' | 'accepted' | 'blocked' // Trạng thái quan hệ
  created_at?: Date
  updated_at?: Date // Thời điểm cập nhật gần nhất
  is_mutual?: boolean // cần kiểm tra nếu user A theo dõi user B rồi thì khi user B theo dõi user A thì is_mutual sẽ là true, khi này sẽ hiển thị là bạn bè
}

export default class Follower {
  _id: ObjectId
  follow_id: ObjectId
  followed_id: ObjectId
  status: 'pending' | 'accepted' | 'blocked'
  created_at: Date
  updated_at: Date
  is_mutual: boolean

  constructor({
    _id,
    follow_id,
    followed_id,
    status = 'accepted',
    created_at,
    updated_at,
    is_mutual = false
  }: FollowersType) {
    this._id = _id || new ObjectId()
    this.follow_id = follow_id
    this.followed_id = followed_id
    this.status = status
    this.created_at = created_at || new Date()
    this.updated_at = updated_at || new Date()
    this.is_mutual = is_mutual
  }
}
