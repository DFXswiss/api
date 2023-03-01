import { EntityRepository, Repository } from 'typeorm';
import { UserData, UserDataStatus } from './user-data.entity';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async setNewUpdateTime(userDataId: number): Promise<void> {
    await this.update(userDataId, { updated: new Date() });
  }

  async activateUserData(userData: UserData): Promise<void> {
    if (userData.status === UserDataStatus.NA) await this.update(userData.id, { status: UserDataStatus.ACTIVE });
  }
}
