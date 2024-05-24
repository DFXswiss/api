import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RouteDto } from 'src/shared/dto/route.dto';
import { BuyController } from 'src/subdomains/core/buy-crypto/routes/buy/buy.controller';
import { SwapController } from 'src/subdomains/core/buy-crypto/routes/swap/swap.controller';
import { SellController } from 'src/subdomains/core/sell-crypto/route/sell.controller';

@ApiTags('Route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly swapController: SwapController,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: RouteDto })
  @ApiExcludeEndpoint()
  async getAllRoutes(@GetJwt() jwt: JwtPayload): Promise<RouteDto> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.swapController.getAllSwap(jwt),
    ]).then(([buy, sell, crypto]) => ({ buy, sell, crypto }));
  }
}
