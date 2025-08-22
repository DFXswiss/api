import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { UserData } from './user-data.entity';
import { UserDataStatus } from './user-data.enum';

@Injectable()
export class UserDataRepository extends BaseRepository<UserData> {
  constructor(manager: EntityManager) {
    super(UserData, manager);
  }

  async setNewUpdateTime(userDataId: number): Promise<void> {
    await this.update(userDataId, { updated: new Date() });
  }

  async activateUserData(userData: UserData): Promise<void> {
    if (userData.status === UserDataStatus.NA) await this.update(userData.id, { status: UserDataStatus.ACTIVE });
  }
}
