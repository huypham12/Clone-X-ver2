import { ObjectId } from 'mongodb'

export type FollowersType = {
  _id?: ObjectId
  follow_user_id: ObjectId // ID của người theo dõi
  followed_user_id: ObjectId // ID của người được theo dõi
  created_at?: Date
  updated_at?: Date // Thời điểm cập nhật gần nhất
}

export default class Follower {
  _id: ObjectId
  follow_user_id: ObjectId
  followed_user_id: ObjectId
  created_at: Date
  updated_at: Date

  constructor({ _id, follow_user_id, followed_user_id, created_at, updated_at }: FollowersType) {
    this._id = _id || new ObjectId()
    this.follow_user_id = follow_user_id
    this.followed_user_id = followed_user_id

    this.created_at = created_at || new Date()
    this.updated_at = updated_at || new Date()
  }
}
