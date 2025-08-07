import DatabaseService from '~/config/database.service'

export class UserService {
  constructor(private readonly databaseService: DatabaseService) {}
}
