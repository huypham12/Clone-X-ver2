import { Request, Response, NextFunction, RequestHandler } from 'express'

export const wrapController = (handler: (...args: any[]) => Promise<any>): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error) // truyền lỗi cho error middleware
    }
  }
}
