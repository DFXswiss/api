import { EntityRepository, Repository } from 'typeorm';
import { Ref } from './ref.entity';

@EntityRepository(Ref)
export class RefRepository extends Repository<Ref> {
  async getAndRemove(ip: string): Promise<Ref> {
    const ref = await this.findOne({ ip });
    if (ref) {
      await this.remove(ref);
    }

    return ref;
  }
}
