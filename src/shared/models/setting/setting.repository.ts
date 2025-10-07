import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Setting } from './setting.entity';

@Injectable()
export class SettingRepository extends CachedRepository<Setting> {
  constructor(manager: EntityManager) {
    super(Setting, manager);
  }
}
