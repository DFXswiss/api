import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, Like } from 'typeorm';
import { User, UserStatus } from './user.entity';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(manager: EntityManager) {
    super(User, manager);
  }

  async getByAddress(address: string, needsRelation = false): Promise<User> {
    return this.findOne({
      where: { address },
      relations: needsRelation ? { userData: true, wallet: true } : {},
    });
  }

  async activateUser(user: User): Promise<void> {
    if (user.status === UserStatus.NA) {
      let ref = user.ref ?? (await this.getNextRef());
      // retry (in case of ref conflict)
      await Util.retry(
        () => this.update(...user.activateUser(ref)),
        3,
        0,
        async () => (ref = await this.getNextRef()),
      );
    }
  }

  private async getNextRef(): Promise<string> {
    // get highest numerical ref
    const nextRef = await this.findOne({
      select: ['id', 'ref'],
      where: { ref: Like('%[0-9]-[0-9]%') },
      order: { ref: 'DESC' },
    }).then((u) => +u.ref.replace('-', '') + 1);

    const ref = nextRef.toString().padStart(6, '0');
    return `${ref.slice(0, 3)}-${ref.slice(3, 6)}`;
  }
}
