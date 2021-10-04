import { EntityRepository, Repository } from 'typeorm';
import { Ref } from './ref.entity';

@EntityRepository(Ref)
export class RefRepository extends Repository<Ref> {
  async addOrUpdate(ip: string, ref: string): Promise<Ref> {
    const refObj = (await this.findOne({ ip })) ?? this.create({ip, ref});
    refObj.ref = ref;

    return await this.save(refObj);
  }

  async getAndRemove(ip: string): Promise<Ref> {
    const ref = await this.findOne({ ip });
    if (ref) {
      await this.remove(ref);
    }

    return ref;
  }
}
