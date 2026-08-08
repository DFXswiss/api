import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { FiatRepublicPayee } from '../entities/fiat-republic-payee.entity';

@Injectable()
export class FiatRepublicPayeeRepository extends BaseRepository<FiatRepublicPayee> {
  constructor(manager: EntityManager) {
    super(FiatRepublicPayee, manager);
  }
}
