import type { ClientSession, ObjectId } from 'mongodb'
import DatabaseService, { databaseService as sharedDatabaseService } from '~/config/database.service'
import { NotificationTargetType } from '~/constants/enums'

export class NotificationLifecycleGuardService {
  constructor(private readonly databaseService: DatabaseService = sharedDatabaseService) {}

  async touchUserPair(first: ObjectId, second: ObjectId, at: Date, session: ClientSession): Promise<boolean> {
    const ids = [first.toHexString(), second.toHexString()].sort()
    const guard = await this.touch(`PAIR:${ids[0]}:${ids[1]}`, session)
    return guard?.unblocked_at instanceof Date && at < guard.unblocked_at
  }

  async touchTarget(
    targetType: NotificationTargetType,
    targetId: ObjectId,
    at: Date,
    session: ClientSession
  ): Promise<boolean> {
    const guard = await this.touch(`TARGET:${targetType}:${targetId.toHexString()}`, session)
    return guard?.restored_at instanceof Date && at < guard.restored_at
  }

  async markUserPairBlocked(first: ObjectId, second: ObjectId, at: Date, session: ClientSession): Promise<void> {
    const ids = [first.toHexString(), second.toHexString()].sort()
    await this.databaseService.notificationLifecycleGuards.updateOne(
      { _id: `PAIR:${ids[0]}:${ids[1]}` },
      {
        $inc: { revision: 1 },
        $set: { blocked_at: at, updated_at: at },
        $unset: { unblocked_at: '' },
        $setOnInsert: { _id: `PAIR:${ids[0]}:${ids[1]}` }
      },
      { upsert: true, session }
    )
  }

  async markUserPairUnblocked(first: ObjectId, second: ObjectId, at: Date, session: ClientSession): Promise<void> {
    const ids = [first.toHexString(), second.toHexString()].sort()
    await this.databaseService.notificationLifecycleGuards.updateOne(
      { _id: `PAIR:${ids[0]}:${ids[1]}` },
      {
        $inc: { revision: 1 },
        $set: { unblocked_at: at, updated_at: at },
        $setOnInsert: { _id: `PAIR:${ids[0]}:${ids[1]}` }
      },
      { upsert: true, session }
    )
  }

  async markTargetHidden(
    targetType: NotificationTargetType,
    targetId: ObjectId,
    at: Date,
    session: ClientSession
  ): Promise<void> {
    const key = `TARGET:${targetType}:${targetId.toHexString()}`
    await this.databaseService.notificationLifecycleGuards.updateOne(
      { _id: key },
      {
        $inc: { revision: 1 },
        $set: { hidden_at: at, updated_at: at },
        $unset: { restored_at: '' },
        $setOnInsert: { _id: key }
      },
      { upsert: true, session }
    )
  }

  async markTargetRestored(
    targetType: NotificationTargetType,
    targetId: ObjectId,
    at: Date,
    session: ClientSession
  ): Promise<void> {
    const key = `TARGET:${targetType}:${targetId.toHexString()}`
    await this.databaseService.notificationLifecycleGuards.updateOne(
      { _id: key },
      {
        $inc: { revision: 1 },
        $set: { restored_at: at, updated_at: at },
        $setOnInsert: { _id: key }
      },
      { upsert: true, session }
    )
  }

  private async touch(key: string, session: ClientSession) {
    return this.databaseService.notificationLifecycleGuards.findOneAndUpdate(
      { _id: key },
      { $inc: { revision: 1 }, $set: { updated_at: new Date() }, $setOnInsert: { _id: key } },
      { upsert: true, returnDocument: 'after', session }
    )
  }
}
