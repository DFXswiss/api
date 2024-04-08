import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Swap } from './swap.entity';

@Injectable()
export class SwapRepository extends BaseRepository<Swap> {
  constructor(manager: EntityManager) {
    super(Swap, manager);
  }
}
