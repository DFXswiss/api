import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { RealUnitTransferRequest } from '../entities/realunit-transfer-request.entity';

// --- W2W TRANSFER --- //

@Injectable()
export class RealUnitTransferRequestRepository extends BaseRepository<RealUnitTransferRequest> {
  constructor(manager: EntityManager) {
    super(RealUnitTransferRequest, manager);
  }
}
