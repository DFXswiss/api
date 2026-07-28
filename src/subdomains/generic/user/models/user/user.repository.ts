import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, Raw, Repository } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { User } from './user.entity';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(manager: EntityManager) {
    super(User, manager);
  }

  async setUserRef(user: User, kycLevel: KycLevel, manager?: EntityManager): Promise<void> {
    if (!user.ref && kycLevel >= KycLevel.LEVEL_50) {
      const repo = manager?.getRepository(User) ?? this;
      let ref = await this.getNextRef(repo);
      // retry (in case of ref conflict)
      await Util.retry(
        () => repo.update(...user.setRef(ref)),
        3,
        0,
        async () => (ref = await this.getNextRef(repo)),
      );
    }
  }

  private async getNextRef(repo: Repository<User>): Promise<string> {
    // get highest numerical ref
    const nextRef = await repo
      .findOne({
        select: { id: true, ref: true },
        where: { ref: Raw((alias) => `${alias} ~ '^[0-9]{3}-[0-9]{3}$'`) },
        order: { ref: 'DESC' },
      })
      .then((u) => +u.ref.replace('-', '') + 1);

    const ref = nextRef.toString().padStart(6, '0');
    return `${ref.slice(0, 3)}-${ref.slice(3, 6)}`;
  }
}
