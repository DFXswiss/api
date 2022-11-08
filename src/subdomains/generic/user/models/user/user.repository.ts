import { EntityRepository, Repository } from 'typeorm';
import { User } from './user.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async getByAddress(address: string, needsRelation = false): Promise<User> {
    return this.findOne({ where: { address }, relations: needsRelation ? ['userData', 'wallet'] : [] });
  }
}
