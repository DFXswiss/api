import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, Like } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { User } from './user.entity';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(manager: EntityManager) {
    super(User, manager);
  }

  async setUserRef(user: User, kycLevel: KycLevel): Promise<void> {
    if (!user.ref && kycLevel >= KycLevel.LEVEL_50) {
      let ref = await this.getNextRef();
      // retry (in case of ref conflict)
      await Util.retry(
        () => this.update(...user.setRef(ref)),
        3,
        0,
        async () => (ref = await this.getNextRef()),
      );
    }
  }

  private async getNextRef(): Promise<string> {
    // get highest numerical ref
    const nextRef = await this.findOne({
      select: { id: true, ref: true },
      where: { ref: Like('%[0-9]-[0-9]%') },
      order: { ref: 'DESC' },
    }).then((u) => +u.ref.replace('-', '') + 1);

    const ref = nextRef.toString().padStart(6, '0');
    return `${ref.slice(0, 3)}-${ref.slice(3, 6)}`;
  }
}
