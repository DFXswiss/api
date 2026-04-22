import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BitcoinUtxo } from '../entities/bitcoin-utxo.entity';

@Injectable()
export class BitcoinUtxoRepository extends BaseRepository<BitcoinUtxo> {
  constructor(manager: EntityManager) {
    super(BitcoinUtxo, manager);
  }
}
