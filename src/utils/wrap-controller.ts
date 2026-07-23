import { Request, Response, NextFunction, RequestHandler } from 'express'

// các lỗi được throw sẽ được đưa vào next(error) phải next để tới middleware xử lý lỗi tổng, nếu chỉ throw thì server có thể bị crash
export const wrapController = (handler: (...args: any[]) => Promise<any>): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error) // truyền lỗi cho error middleware
    }
  }
}
