import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/utils/util';
import { IsNull, LessThan } from 'typeorm';
import { Ref } from './ref.entity';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  private readonly refExpirationDays = 3;

  constructor(private repo: RefRepository) {}

  @Interval(3600000)
  async checkRefs(): Promise<void> {
    const expirationDate = Util.daysBefore(this.refExpirationDays);

    const expiredRefs = await this.repo.find({ updated: LessThan(expirationDate), origin: IsNull() });
    await this.repo.remove(expiredRefs);
  }

  async addOrUpdate(ip: string, ref?: string, origin?: string): Promise<Ref | undefined> {
    try {
      const entity = (await this.repo.findOne({ ip })) ?? this.repo.create({ ip, ref, origin });

      // ignore update if ref is still valid
      if (entity.updated && Util.daysDiff(entity.updated, new Date()) < this.refExpirationDays) return;

      return await this.repo.save({ ...entity, ref, origin });
    } catch (e) {
      console.log('Exception during ref update:', e);
    }
  }

  async get(ip: string): Promise<Ref | undefined> {
    return this.repo.getAndRemove(ip);
  }
}
