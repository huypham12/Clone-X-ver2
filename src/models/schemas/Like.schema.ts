import { ObjectId } from 'mongodb'

interface Like {
  _id?: ObjectId
  user_id: ObjectId // ID của người dùng thích
  tweet_id: ObjectId // ID của tweet được thích
  created_at: Date
}

export default class LikeModel {
  _id?: ObjectId
  user_id: ObjectId
  tweet_id: ObjectId
  created_at: Date

  constructor({ user_id, tweet_id }: { user_id: ObjectId; tweet_id: ObjectId }) {
    if (!user_id || !tweet_id) {
      throw new Error('user_id and tweet_id are required')
    }
    this._id = new ObjectId()
    this.user_id = user_id
    this.tweet_id = tweet_id
    this.created_at = new Date()
  }
}
