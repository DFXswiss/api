import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { BlockchainFee } from '../entities/blockchain-fee.entity';

@Injectable()
export class BlockchainFeeRepository extends CachedRepository<BlockchainFee> {
  constructor(manager: EntityManager) {
    super(BlockchainFee, manager);
  }
}
