import { createHash } from 'crypto'

const digestJobIdentity = (parts: string[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex')

export const createBullMqJobId = (namespace: string, ...identityParts: string[]): string =>
  `${namespace}-${digestJobIdentity(identityParts)}`
