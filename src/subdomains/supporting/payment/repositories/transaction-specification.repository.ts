import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionSpecification } from '../entities/transaction-specification.entity';

@Injectable()
export class TransactionSpecificationRepository extends BaseRepository<TransactionSpecification> {
  constructor(manager: EntityManager) {
    super(TransactionSpecification, manager);
  }
}
