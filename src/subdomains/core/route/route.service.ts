import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { Route } from './route.entity';
import { RouteRepository } from './route.repository';

@Injectable()
export class RouteService {
  constructor(private readonly routeRepo: RouteRepository) {}

  // the route is always created in its owner's transaction, so that a failing owner insert
  // (buy/sell/swap) rolls the route back instead of orphaning it
  async createRoute(dto: CreateRouteDto, manager: EntityManager): Promise<Route> {
    return manager.save(this.routeRepo.create(dto));
  }

  async updateRoute(id: number, dto: UpdateRouteDto): Promise<Route> {
    const entity = await this.routeRepo.findOne({
      where: { id },
      relations: { buy: true, sell: true, swap: true },
    });
    if (!entity) throw new NotFoundException('Route not found');

    const update = this.routeRepo.create(dto);

    if (update.label && (await this.routeRepo.existsBy({ label: update.label })))
      throw new BadRequestException('Label already in use');

    return this.routeRepo.save(Object.assign(entity, update));
  }
}
