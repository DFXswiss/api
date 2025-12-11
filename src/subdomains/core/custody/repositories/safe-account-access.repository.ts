import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SafeAccountAccess } from '../entities/safe-account-access.entity';

@Injectable()
export class SafeAccountAccessRepository extends BaseRepository<SafeAccountAccess> {
  constructor(manager: EntityManager) {
    super(SafeAccountAccess, manager);
  }
}
