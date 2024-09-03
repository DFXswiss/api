import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BuyService } from '../buy-crypto/routes/buy/buy.service';
import { SwapService } from '../buy-crypto/routes/swap/swap.service';
import { SellService } from '../sell-crypto/route/sell.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { Route } from './route.entity';
import { RouteRepository } from './route.repository';

@Injectable()
export class RouteService {
  constructor(
    private readonly routeRepo: RouteRepository,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly swapService: SwapService,
  ) {}

  async createRoute(dto: CreateRouteDto): Promise<Route> {
    const entity = this.routeRepo.create(dto);

    if (dto.buy) {
      entity.buy = await this.buyService.get(undefined, dto.buy.id);
      if (!entity.buy) throw new NotFoundException('Buy not found');
    }

    if (dto.sell) {
      entity.sell = await this.sellService.get(undefined, dto.sell.id);
      if (!entity.sell) throw new NotFoundException('Sell not found');
    }

    if (dto.swap) {
      entity.swap = await this.swapService.get(undefined, dto.swap.id);
      if (!entity.swap) throw new NotFoundException('Swap not found');
    }

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
