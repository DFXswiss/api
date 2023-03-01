import { Util } from 'src/shared/utils/util';
import { EntityRepository, Like, Repository } from 'typeorm';
import { User, UserStatus } from './user.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async getByAddress(address: string, needsRelation = false): Promise<User> {
    return this.findOne({ where: { address }, relations: needsRelation ? ['userData', 'wallet'] : [] });
  }

  async activateUser(user: User): Promise<void> {
    if (user.status === UserStatus.NA) {
      // retry (in case of ref conflict)
      await Util.retry(async () => {
        const ref = user.ref ?? (await this.getNextRef());
        await this.update(user.id, { status: UserStatus.ACTIVE, ref });
      }, 3);
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
