import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { FaucetRequest } from '../entities/faucet-request.entity';

@Injectable()
export class FaucetRequestRepository extends BaseRepository<FaucetRequest> {
  constructor(manager: EntityManager) {
    super(FaucetRequest, manager);
  }
}
