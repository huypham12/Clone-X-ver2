import { UserService } from './user.service'
import { PostHandler } from '~/types/controller-handler.type'

export class UserController {
  constructor(private readonly userService: UserService) {}
}
