import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { AktionariatRegistration } from '../entities/aktionariat-registration.entity';

@Injectable()
export class AktionariatRegistrationRepository extends BaseRepository<AktionariatRegistration> {
  constructor(manager: EntityManager) {
    super(AktionariatRegistration, manager);
  }
}
