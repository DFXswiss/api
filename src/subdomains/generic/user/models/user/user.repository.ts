import { EntityRepository, Repository } from 'typeorm';
import { User, UserStatus } from './user.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async getByAddress(address: string, needsRelation = false): Promise<User> {
    return this.findOne({ where: { address }, relations: needsRelation ? ['userData', 'wallet'] : [] });
  }
  async activateUser(user: User): Promise<void> {
    if (user?.status === UserStatus.NA) await this.update(user.id, { status: UserStatus.ACTIVE });
  }
}
