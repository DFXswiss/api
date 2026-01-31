import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { OlkyPayerAccount } from '../entities/olky-payer-account.entity';

@Injectable()
export class OlkyPayerAccountRepository extends BaseRepository<OlkyPayerAccount> {
  constructor(manager: EntityManager) {
    super(OlkyPayerAccount, manager);
  }
}
