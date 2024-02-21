import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RouteDto } from 'src/shared/dto/route.dto';
import { BuyController } from 'src/subdomains/core/buy-crypto/routes/buy/buy.controller';
import { CryptoRouteController } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.controller';
import { SellController } from 'src/subdomains/core/sell-crypto/route/sell.controller';

@ApiTags('Route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly cryptoRouteController: CryptoRouteController,
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
      this.cryptoRouteController.getAllCrypto(jwt),
    ]).then(([buy, sell, crypto]) => ({ buy, sell, crypto }));
  }
}
