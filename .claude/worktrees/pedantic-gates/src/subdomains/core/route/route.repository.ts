import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Route } from './route.entity';

@Injectable()
export class RouteRepository extends BaseRepository<Route> {
  constructor(manager: EntityManager) {
    super(Route, manager);
  }
}
