import { Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/util';
import { LessThan } from 'typeorm';
import { Ref } from './ref.entity';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  constructor(private refRepository: RefRepository) {}

  @Interval(3600000)
  async checkRefs(): Promise<void> {
    // registered refs expire after 3 days
    const expirationDate = Util.daysBefore(3);

    const expiredRefs = await this.refRepository.find({ updated: LessThan(expirationDate) });
    await this.refRepository.remove(expiredRefs);
  }

  async addOrUpdate(ip: string, ref: string): Promise<Ref> {
    return this.refRepository.addOrUpdate(ip, ref);
  }

  async get(ip: string): Promise<string> {
    const ref = await this.refRepository.getAndRemove(ip);
    if (!ref) throw new NotFoundException('No matching ref for ip found');

    return ref.ref;
  }
}
