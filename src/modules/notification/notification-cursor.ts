import { ObjectId } from 'mongodb'

const OPAQUE_CURSOR_VERSION = 2
const LEGACY_OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/

export interface NotificationTupleCursor {
  kind: 'tuple'
  created_at: Date
  _id: ObjectId
}

export interface NotificationLegacyCursor {
  kind: 'legacy'
  _id: ObjectId
}

export type DecodedNotificationCursor = NotificationTupleCursor | NotificationLegacyCursor

interface SerializedNotificationCursor {
  v: number
  created_at: string
  _id: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const encodeNotificationCursor = (cursor: Pick<NotificationTupleCursor, 'created_at' | '_id'>): string => {
  const serialized: SerializedNotificationCursor = {
    v: OPAQUE_CURSOR_VERSION,
    created_at: cursor.created_at.toISOString(),
    _id: cursor._id.toHexString()
  }

  return Buffer.from(JSON.stringify(serialized), 'utf8').toString('base64url')
}

export const decodeNotificationCursor = (cursor: string): DecodedNotificationCursor => {
  if (LEGACY_OBJECT_ID_PATTERN.test(cursor)) {
    return { kind: 'legacy', _id: new ObjectId(cursor) }
  }

  if (!BASE64_URL_PATTERN.test(cursor)) {
    throw new Error('Notification cursor must be an opaque cursor or a legacy ObjectId')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Notification cursor is malformed')
  }

  if (
    !isRecord(parsed) ||
    parsed.v !== OPAQUE_CURSOR_VERSION ||
    typeof parsed.created_at !== 'string' ||
    typeof parsed._id !== 'string' ||
    !ObjectId.isValid(parsed._id)
  ) {
    throw new Error('Notification cursor payload is invalid')
  }

  const createdAt = new Date(parsed.created_at)
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed.created_at) {
    throw new Error('Notification cursor timestamp is invalid')
  }

  return {
    kind: 'tuple',
    created_at: createdAt,
    _id: new ObjectId(parsed._id)
  }
}

export const isNotificationCursor = (cursor: string): boolean => {
  try {
    decodeNotificationCursor(cursor)
    return true
  } catch {
    return false
  }
}
