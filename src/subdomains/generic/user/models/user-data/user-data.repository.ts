import { EntityRepository, Repository } from 'typeorm';
import { UserData } from './user-data.entity';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async setNewUpdateTime(userDataId: number): Promise<void> {
    await this.update(userDataId, { updated: new Date() });
  }
}
