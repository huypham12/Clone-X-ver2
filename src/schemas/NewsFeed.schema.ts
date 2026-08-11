import { ObjectId } from 'mongodb'

interface NewsFeedType {
  _id?: ObjectId
  user_id: ObjectId // Người nhận feed
  tweet_id: ObjectId // Bài viết
  created_at?: Date // Thời gian bài viết được đưa vào feed, dùng để sort
}

export default class NewsFeed {
  _id?: ObjectId
  user_id: ObjectId
  tweet_id: ObjectId
  created_at: Date

  constructor(newsFeed: NewsFeedType) {
    this._id = newsFeed._id || new ObjectId()
    this.user_id = newsFeed.user_id
    this.tweet_id = newsFeed.tweet_id
    this.created_at = newsFeed.created_at || new Date()
  }
}
