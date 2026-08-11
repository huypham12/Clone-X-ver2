import { databaseService } from '~/config/database.service'
import redisService from '~/config/redis.service'
import { pingBullMqRedis } from '~/config/redisConfig'

const HEALTH_CHECK_TIMEOUT_MS = 1_500

type DependencyStatus = 'up' | 'down'
type DependencyCheck = () => Promise<unknown>

export interface ReadinessResult {
  status: 'ready' | 'not_ready'
  checks: {
    mongodb: DependencyStatus
    redis: DependencyStatus
  }
}

export interface ReadinessDependencies {
  mongodb: DependencyCheck
  redisCache: DependencyCheck
  redisQueue: DependencyCheck
}

const checkWithTimeout = async (check: DependencyCheck): Promise<DependencyStatus> => {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Health check timed out')), HEALTH_CHECK_TIMEOUT_MS)
      })
    ])
    return 'up'
  } catch {
    return 'down'
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const defaultDependencies: ReadinessDependencies = {
  mongodb: () => databaseService.ping(),
  redisCache: () => redisService.ping(),
  redisQueue: () => pingBullMqRedis()
}

export const checkReadiness = async (
  dependencies: ReadinessDependencies = defaultDependencies
): Promise<ReadinessResult> => {
  const [mongodb, redisCache, redisQueue] = await Promise.all([
    checkWithTimeout(dependencies.mongodb),
    checkWithTimeout(dependencies.redisCache),
    checkWithTimeout(dependencies.redisQueue)
  ])
  const redis = redisCache === 'up' && redisQueue === 'up' ? 'up' : 'down'

  return {
    status: mongodb === 'up' && redis === 'up' ? 'ready' : 'not_ready',
    checks: { mongodb, redis }
  }
}
