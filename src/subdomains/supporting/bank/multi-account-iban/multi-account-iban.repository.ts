import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { MultiAccountIban } from './multi-account-iban.entity';

@Injectable()
export class MultiAccountIbanRepository extends BaseRepository<MultiAccountIban> {
  constructor(manager: EntityManager) {
    super(MultiAccountIban, manager);
  }
}
