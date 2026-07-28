export class HttpError extends Error {
  statusCode: number
  errors?: Record<string, string[]>
  code?: string

  constructor(message: string, statusCode: number, errors?: Record<string, string[]>, code?: string) {
    super(message)
    this.statusCode = statusCode
    this.errors = errors
    this.code = code
  }
}
