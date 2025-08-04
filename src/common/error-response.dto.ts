export class ErrorResponseDto {
  constructor(
    public statusCode: number,
    public message: string,
    public error: Record<string, string[]> // Ví dụ: { email: ['Email is invalid'], password: ['Too short', 'Must contain a number'] }
  ) {}
}
