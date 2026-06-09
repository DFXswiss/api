import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PartnerConsent } from './partner-consent.entity';

@Injectable()
export class PartnerConsentRepository extends BaseRepository<PartnerConsent> {
  constructor(manager: EntityManager) {
    super(PartnerConsent, manager);
  }
}
