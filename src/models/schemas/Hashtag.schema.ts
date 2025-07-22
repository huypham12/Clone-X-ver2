import { ObjectId } from 'mongodb'
interface HashtagType {
  _id?: ObjectId
  normalized_name: string // Tên hashtag đã được chuẩn hóa trước khi đưa vào db(ví dụ: "travel")
  post_count: number // Số lượng bài đăng sử dụng hashtag
  created_at?: Date
  updated_at?: Date // Thời điểm cập nhật gần nhất
}

export default class Hashtag {
  _id: ObjectId
  normalized_name: string
  post_count: number
  created_at: Date
  updated_at: Date

  constructor(hashtag: HashtagType) {
    this._id = hashtag._id || new ObjectId()
    this.normalized_name = hashtag.normalized_name
    this.post_count = hashtag.post_count
    this.created_at = hashtag.created_at || new Date()
    this.updated_at = hashtag.updated_at || new Date()
  }
}
