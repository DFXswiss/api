import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Organization } from './organization.entity';

@Injectable()
export class OrganizationRepository extends BaseRepository<Organization> {
  constructor(manager: EntityManager) {
    super(Organization, manager);
  }
}
