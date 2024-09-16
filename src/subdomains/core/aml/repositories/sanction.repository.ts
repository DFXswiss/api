import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Sanction } from '../entities/sanction.entity';

@Injectable()
export class SanctionRepository extends BaseRepository<Sanction> {
  constructor(manager: EntityManager) {
    super(Sanction, manager);
  }
}
