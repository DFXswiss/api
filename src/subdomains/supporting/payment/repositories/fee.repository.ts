import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Fee } from '../entities/fee.entity';

@Injectable()
export class FeeRepository extends CachedRepository<Fee> {
  constructor(manager: EntityManager) {
    super(Fee, manager);
  }
}
