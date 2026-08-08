import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { FiatRepublicEndUser } from '../entities/fiat-republic-end-user.entity';

@Injectable()
export class FiatRepublicEndUserRepository extends BaseRepository<FiatRepublicEndUser> {
  constructor(manager: EntityManager) {
    super(FiatRepublicEndUser, manager);
  }
}
