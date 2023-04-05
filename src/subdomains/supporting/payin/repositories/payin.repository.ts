import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CryptoInput } from '../entities/crypto-input.entity';

@Injectable()
export class PayInRepository extends BaseRepository<CryptoInput> {
  constructor(manager: EntityManager) {
    super(CryptoInput, manager);
  }
}
