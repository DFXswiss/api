import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/util';
import { LessThan } from 'typeorm';
import { Ref } from './ref.entity';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  constructor(private refRepo: RefRepository) {}

  @Interval(3600000)
  async checkRefs(): Promise<void> {
    // registered refs expire after 3 days
    const expirationDate = Util.daysBefore(3);

    const expiredRefs = await this.refRepo.find({ updated: LessThan(expirationDate) });
    await this.refRepo.remove(expiredRefs);
  }

  async addOrUpdate(ip: string, ref?: string, origin?: string): Promise<Ref | undefined> {
    try {
      return await this.refRepo.addOrUpdate(ip, ref, origin);
    } catch (e) {
      console.error('Exception during ref update:', e);
    }
  }

  async get(ip: string): Promise<Ref | undefined> {
    return await this.refRepo.getAndRemove(ip);
  }
}
