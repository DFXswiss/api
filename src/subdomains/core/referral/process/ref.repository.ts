import { EntityRepository, Repository } from 'typeorm';
import { Ref } from './ref.entity';

@EntityRepository(Ref)
export class RefRepository extends Repository<Ref> {
  async addOrUpdate(ip: string, ref?: string, origin?: string): Promise<Ref> {
    const entity = (await this.findOne({ ip })) ?? this.create({ ip, ref, origin });

    return await this.save({ ...entity, ref, origin });
  }

  async getAndRemove(ip: string): Promise<Ref> {
    const ref = await this.findOne({ ip });
    if (ref) {
      await this.remove(ref);
    }

    return ref;
  }
}
