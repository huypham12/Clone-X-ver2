import { Router, type RequestHandler } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { checkReadiness, type ReadinessResult } from './health.service'

type ReadinessCheck = () => Promise<ReadinessResult>

export const createHealthRouter = (readinessCheck: ReadinessCheck = checkReadiness): Router => {
  const router = Router()

  router.get('/live', ((_req, res) => {
    res.status(HTTP_STATUS.OK).json({
      status: 'live',
      timestamp: new Date().toISOString()
    })
  }) satisfies RequestHandler)

  router.get('/ready', (async (_req, res) => {
    const readiness = await readinessCheck()
    const statusCode = readiness.status === 'ready' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE

    res.status(statusCode).json({
      ...readiness,
      timestamp: new Date().toISOString()
    })
  }) satisfies RequestHandler)

  return router
}

export default createHealthRouter()
