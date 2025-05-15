import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RouteDto } from 'src/shared/dto/route.dto';
import { BuyController } from '../buy-crypto/routes/buy/buy.controller';
import { SwapController } from '../buy-crypto/routes/swap/swap.controller';
import { SellController } from '../sell-crypto/route/sell.controller';
import { UpdateRouteDto } from './dto/update-route.dto';
import { Route } from './route.entity';
import { RouteService } from './route.service';

@ApiTags('route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly routeService: RouteService,
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly swapController: SwapController,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserActiveGuard)
  @ApiOkResponse({ type: RouteDto })
  @ApiExcludeEndpoint()
  async getAllRoutes(@GetJwt() jwt: JwtPayload): Promise<RouteDto> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.swapController.getAllSwap(jwt),
    ]).then(([buy, sell, swap]) => ({ buy, sell, swap, crypto: swap }));
  }


  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateRoute(@Param('id') id: string, @Body() dto: UpdateRouteDto): Promise<Route> {
    return this.routeService.updateRoute(+id, dto);
  }
}
