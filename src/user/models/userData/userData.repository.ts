import { EntityRepository, Repository } from 'typeorm';
import { UserData } from './userData.entity';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async getAllUserData(): Promise<UserData[]> {
    return await this.find({ relations: ['bankDatas', 'users'] });
  }
}
