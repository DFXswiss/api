import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingController } from '../../../mix/models/staking/staking.controller';
import { SellController } from '../../../subdomains/core/sell-crypto/sell/sell.controller';
import { CryptoRouteController } from '../../../mix/models/crypto-route/crypto-route.controller';
import { BuyController } from 'src/subdomains/core/buy-crypto/route/buy.controller';
import { RouteDto } from './dto/route.dto';

@ApiTags('Route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly stakingController: StakingController,
    private readonly cryptoRouteController: CryptoRouteController,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: RouteDto })
  async getAllRoutes(@GetJwt() jwt: JwtPayload): Promise<RouteDto> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.stakingController.getAllStaking(jwt),
      this.cryptoRouteController.getAllCrypto(jwt),
    ]).then(([buy, sell, staking, crypto]) => ({ buy, sell, staking, crypto }));
  }
}
