import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { Route } from './route.entity';
import { RouteRepository } from './route.repository';

@Injectable()
export class RouteService {
  constructor(private readonly routeRepo: RouteRepository) {}

  async createRoute(dto: CreateRouteDto): Promise<Route> {
    const entity = this.routeRepo.create(dto);

    return this.routeRepo.save(entity);
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
