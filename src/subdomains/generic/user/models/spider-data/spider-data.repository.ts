import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SpiderData } from './spider-data.entity';

@Injectable()
export class SpiderDataRepository extends BaseRepository<SpiderData> {
  constructor(manager: EntityManager) {
    super(SpiderData, manager);
  }
}
