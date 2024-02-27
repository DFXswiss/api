import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BlockchainFee } from '../entities/blockchain-fee.entity';

@Injectable()
export class BlockchainFeeRepository extends BaseRepository<BlockchainFee> {
  constructor(manager: EntityManager) {
    super(BlockchainFee, manager);
  }
}
