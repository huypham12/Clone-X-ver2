import { ObjectId } from 'mongodb'

export type FollowersType = {
  _id?: ObjectId
  follow_user_id: ObjectId // ID của người theo dõi
  followed_user_id: ObjectId // ID của người được theo dõi
  post_notifications_enabled?: boolean
  created_at?: Date
  updated_at?: Date // Thời điểm cập nhật gần nhất
}

export default class Follower {
  _id: ObjectId
  follow_user_id: ObjectId
  followed_user_id: ObjectId
  post_notifications_enabled: boolean
  created_at: Date
  updated_at: Date

  constructor({
    _id,
    follow_user_id,
    followed_user_id,
    post_notifications_enabled,
    created_at,
    updated_at
  }: FollowersType) {
    this._id = _id || new ObjectId()
    this.follow_user_id = follow_user_id
    this.followed_user_id = followed_user_id
    this.post_notifications_enabled = post_notifications_enabled ?? false

    this.created_at = created_at || new Date()
    this.updated_at = updated_at || new Date()
  }
}
