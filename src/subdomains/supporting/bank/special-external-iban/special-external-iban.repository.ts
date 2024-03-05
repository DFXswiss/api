import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SpecialExternalIban } from './special-external-iban.entity';

@Injectable()
export class SpecialExternalIbanRepository extends BaseRepository<SpecialExternalIban> {
  constructor(manager: EntityManager) {
    super(SpecialExternalIban, manager);
  }
}
