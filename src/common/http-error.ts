export class HttpError extends Error {
  statusCode: number
  errors?: Record<string, string[]>

  constructor(message: string, statusCode: number, errors?: Record<string, string[]>) {
    super(message)
    this.statusCode = statusCode
    this.errors = errors
  }
}
