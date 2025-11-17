import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Faucet } from '../entities/faucet.entity';

@Injectable()
export class FaucetRepository extends BaseRepository<Faucet> {
  constructor(manager: EntityManager) {
    super(Faucet, manager);
  }
}
