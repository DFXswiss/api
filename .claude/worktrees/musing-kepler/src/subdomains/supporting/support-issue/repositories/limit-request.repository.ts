import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LimitRequest } from '../entities/limit-request.entity';

@Injectable()
export class LimitRequestRepository extends BaseRepository<LimitRequest> {
  constructor(manager: EntityManager) {
    super(LimitRequest, manager);
  }
}
