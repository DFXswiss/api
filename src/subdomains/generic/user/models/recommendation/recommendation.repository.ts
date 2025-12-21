import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Recommendation } from './recommendation.entity';

@Injectable()
export class RecommendationRepository extends BaseRepository<Recommendation> {
  constructor(manager: EntityManager) {
    super(Recommendation, manager);
  }
}
