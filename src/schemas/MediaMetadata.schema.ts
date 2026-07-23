import { ObjectId } from 'mongodb'
import { MediaType, MediaStatus } from '~/constants/enums'

type MediaMetadataType = {
  _id?: ObjectId
  url?: string
  public_id?: string
  status?: MediaStatus
  type: MediaType // Tham chiếu từ enum, ví dụ 'image' hoặc 'video'
  thumbnail?: string // Dành cho video
  uploaded_by?: ObjectId // Lưu ID người dùng đã upload file này
  created_at?: Date
  updated_at?: Date
}

export default class MediaMetadata {
  _id: ObjectId
  url: string
  public_id: string
  status: MediaStatus
  type: MediaType
  thumbnail: string
  uploaded_by: ObjectId | null
  created_at: Date
  updated_at: Date

  constructor(data: MediaMetadataType) {
    this._id = data._id || new ObjectId()
    this.url = data.url || ''
    this.public_id = data.public_id || ''
    this.status = data.status || MediaStatus.Pending
    this.type = data.type
    this.thumbnail = data.thumbnail || ''
    this.uploaded_by = data.uploaded_by || null
    this.created_at = data.created_at || new Date()
    this.updated_at = data.updated_at || new Date()
  }
}
