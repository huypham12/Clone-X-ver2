export class SuccessResponseDto<T = any> {
  constructor(
    public statusCode: number,
    public message: string,
    public data: T
  ) {}
}

/* 
  đây là cú pháp ngắn gọn giống với
  
  export class SuccessResponseDto<T = any> {
    statusCode: number
    message: string
    data: T
    constructor(statusCode: number, message: string, data: T) {
      this.statusCode = statusCode
      this.message = message
      this.data = data
    }
  }

*/
