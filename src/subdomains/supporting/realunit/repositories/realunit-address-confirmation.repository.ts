import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { RealUnitAddressConfirmation } from '../entities/realunit-address-confirmation.entity';

@Injectable()
export class RealUnitAddressConfirmationRepository extends BaseRepository<RealUnitAddressConfirmation> {
  constructor(manager: EntityManager) {
    super(RealUnitAddressConfirmation, manager);
  }
}
