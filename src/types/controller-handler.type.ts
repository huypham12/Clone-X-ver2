import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'

/**
 * ControllerHandler là generic type dành cho các controller (route handler).
 * Giúp định nghĩa rõ ràng kiểu cho request và response của từng endpoint.
 *
 * @template ReqBody - kiểu dữ liệu body của request
 * @template ResBody - kiểu dữ liệu body của response
 * @template ReqParams - kiểu dữ liệu của req.params
 * @template ReqQuery - kiểu dữ liệu của req.query
 * @template Locals - kiểu dữ liệu cho biến locals trong response
 */
export type ControllerHandler<
  ReqBody = any,
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = (req: Request<ReqParams, ResBody, ReqBody, ReqQuery, Locals>, res: Response<ResBody>) => Promise<void>

// tạo alias cho các handler khác nhau dựa trên ControllerHandler, như login sẽ dùng PostHandler, getUser sẽ dùng GetHandler, v.v.

export type GetHandler<
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = ControllerHandler<undefined, ResBody, ReqParams, ReqQuery, Locals>

export type PostHandler<
  ReqBody = any,
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = ControllerHandler<ReqBody, ResBody, ReqParams, ReqQuery, Locals>

export type PutHandler<
  ReqBody = any,
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = ControllerHandler<ReqBody, ResBody, ReqParams, ReqQuery, Locals>

export type PatchHandler<
  ReqBody = any,
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = ControllerHandler<ReqBody, ResBody, ReqParams, ReqQuery, Locals>

export type DeleteHandler<
  ResBody = any,
  ReqParams = ParamsDictionary,
  ReqQuery = any,
  Locals extends Record<string, any> = Record<string, any>
> = ControllerHandler<undefined, ResBody, ReqParams, ReqQuery, Locals>
