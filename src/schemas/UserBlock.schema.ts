import { ObjectId } from 'mongodb'

export interface UserBlockType {
  _id?: ObjectId
  user_id: ObjectId
  blocked_user_id: ObjectId
  createdAt?: Date
  updatedAt?: Date
}

export default class UserBlock {
  _id?: ObjectId
  user_id: ObjectId
  blocked_user_id: ObjectId
  createdAt?: Date
  updatedAt?: Date
  constructor(userBlock: UserBlockType) {
    const date = new Date()
    this._id = userBlock._id || new ObjectId()
    this.user_id = userBlock.user_id
    this.blocked_user_id = userBlock.blocked_user_id
    this.createdAt = userBlock.createdAt || date
    this.updatedAt = userBlock.updatedAt || date
  }
}
