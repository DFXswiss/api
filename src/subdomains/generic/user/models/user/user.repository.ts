import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityRepository, Repository } from 'typeorm';
import { User, UserStatus } from './user.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async getByAddress(address: string, blockchain: Blockchain, needsRelation = false): Promise<User> {
    return this.findOne({ where: { address, blockchain }, relations: needsRelation ? ['userData', 'wallet'] : [] });
  }
  async activateUser(user: User): Promise<void> {
    if (user?.status === UserStatus.NA) await this.update(user.id, { status: UserStatus.ACTIVE });
  }
}
