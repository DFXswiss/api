import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionRequest } from '../entities/transaction-request.entity';

@Injectable()
export class TransactionRequestRepository extends BaseRepository<TransactionRequest> {
  constructor(manager: EntityManager) {
    super(TransactionRequest, manager);
  }
}
