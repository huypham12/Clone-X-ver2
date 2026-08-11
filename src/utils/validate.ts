import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodTypeAny } from 'zod'
import { HttpError } from '~/common/http-error'

export const validate = <T extends ZodTypeAny>(schema: T) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.validatedData = await schema.parseAsync({
        body: req.body,
        query: req.query,
        headers: req.headers,
        params: req.params
      })
      next()
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {}
        for (const issue of error.issues) {
          const path = issue.path.join('.') || 'validation'
          errors[path] ??= []
          errors[path].push(issue.message)
        }
        return next(new HttpError('Validation failed', 400, errors))
      }

      console.error('Unexpected validation error', {
        error: error instanceof Error ? error.message : String(error)
      })
      return next(new HttpError('Internal Server Error', 500))
    }
  }
}
