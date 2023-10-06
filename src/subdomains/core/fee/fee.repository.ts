import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Fee } from './fee.entity';

@Injectable()
export class FeeRepository extends BaseRepository<Fee> {
  constructor(manager: EntityManager) {
    super(Fee, manager);
  }
}
