import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { FiatOutput } from './fiat-output.entity';

@Injectable()
export class FiatOutputRepository extends BaseRepository<FiatOutput> {
  constructor(manager: EntityManager) {
    super(FiatOutput, manager);
  }
}
