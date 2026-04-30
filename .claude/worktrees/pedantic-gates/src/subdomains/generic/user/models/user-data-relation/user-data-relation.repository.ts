import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { UserDataRelation } from './user-data-relation.entity';

@Injectable()
export class UserDataRelationRepository extends BaseRepository<UserDataRelation> {
  constructor(manager: EntityManager) {
    super(UserDataRelation, manager);
  }
}
