import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { SpecialCode } from '../entities/special-code.entity';

@Injectable()
export class SpecialCodeRepository extends CachedRepository<SpecialCode> {
  constructor(manager: EntityManager) {
    super(SpecialCode, manager);
  }
}
