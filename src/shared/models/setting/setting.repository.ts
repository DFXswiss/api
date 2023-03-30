import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Setting } from './setting.entity';

@Injectable()
export class SettingRepository extends BaseRepository<Setting> {
  constructor(manager: EntityManager) {
    super(Setting, manager);
  }
}
