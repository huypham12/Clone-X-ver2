export default class NotificationLifecycleGuard {
  _id: string
  revision: number
  updated_at: Date
  blocked_at?: Date
  unblocked_at?: Date
  hidden_at?: Date
  restored_at?: Date

  constructor(_id: string, updatedAt: Date = new Date()) {
    this._id = _id
    this.revision = 1
    this.updated_at = updatedAt
  }
}
