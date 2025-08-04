import { AuthService } from './auth.service'
import { Request, Response } from 'express'
import { RegisterBodyDto, RegisterResponseDto } from './dto'
import { ParamsDictionary } from 'express-serve-static-core'

export class AuthController {
  constructor(private readonly authService: AuthService) {}
  /* tương đương với 

    constructor(authService: AuthService) {
    this.authService = authService;
  }
  */

  // mấy cái tham số này là để express hiểu mình đang dùng kiểu gì
  register = async (
    req: Request<ParamsDictionary, RegisterResponseDto, RegisterBodyDto, any>,
    res: Response<RegisterResponseDto>
  ) => {
    const payload = req.body
    const result = await this.authService.register(payload)
    res.status(result.statusCode).json(result)
  }
}
