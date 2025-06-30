import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { IsNull, LessThan } from 'typeorm';
import { Ref } from './ref.entity';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  private readonly logger: DfxLogger;
  private readonly refExpirationDays = 3;

  constructor(private readonly repo: RefRepository, readonly loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(RefService);
  }

  @DfxCron(CronExpression.EVERY_HOUR, { timeout: 7200 })
  async checkRefs(): Promise<void> {
    const expirationDate = Util.daysBefore(this.refExpirationDays);

    const expiredRefs = await this.repo.findBy({ updated: LessThan(expirationDate), origin: IsNull() });
    await this.repo.remove(expiredRefs);
  }

  async addOrUpdate(ip: string, ref?: string, origin?: string): Promise<Ref | undefined> {
    try {
      const entity = (await this.repo.findOneBy({ ip })) ?? this.repo.create({ ip, ref, origin });

      // ignore update if ref is still valid
      if (entity.updated && Util.daysDiff(entity.updated) < this.refExpirationDays) return;

      return await this.repo.save({ ...entity, ref, origin });
    } catch (e) {
      this.logger.error('Exception during ref update:', e);
    }
  }

  async get(ip: string): Promise<Ref | undefined> {
    return this.repo.getAndRemove(ip);
  }
}
