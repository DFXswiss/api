import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Ref } from './ref.entity';

@Injectable()
export class RefRepository extends BaseRepository<Ref> {
  constructor(manager: EntityManager) {
    super(Ref, manager);
  }

  async getAndRemove(ip: string): Promise<Ref> {
    const ref = await this.findOneBy({ ip });
    if (ref) {
      await this.remove(ref);
    }

    return ref;
  }
}
