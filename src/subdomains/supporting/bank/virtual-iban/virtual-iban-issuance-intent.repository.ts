import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { VirtualIbanIssuanceIntent } from './virtual-iban-issuance-intent.entity';

@Injectable()
export class VirtualIbanIssuanceIntentRepository extends BaseRepository<VirtualIbanIssuanceIntent> {
  constructor(manager: EntityManager) {
    super(VirtualIbanIssuanceIntent, manager);
  }
}
