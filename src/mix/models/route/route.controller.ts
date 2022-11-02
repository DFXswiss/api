import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingDto } from '../../../mix/models/staking/dto/staking.dto';
import { StakingController } from '../../../mix/models/staking/staking.controller';
import { SellController } from '../../../subdomains/core/sell-crypto/sell/sell.controller';
import { SellDto } from '../../../subdomains/core/sell-crypto/sell/dto/sell.dto';
import { CryptoRouteController } from '../../../mix/models/crypto-route/crypto-route.controller';
import { CryptoRouteDto } from '../../../mix/models/crypto-route/dto/crypto-route.dto';
import { BuyController } from 'src/subdomains/core/buy-crypto/route/buy.controller';
import { BuyDto } from 'src/subdomains/core/buy-crypto/route/dto/buy.dto';

@ApiTags('route')
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
  async getAllRoutes(
    @GetJwt() jwt: JwtPayload,
  ): Promise<{ buy: BuyDto[]; sell: SellDto[]; staking: StakingDto[]; crypto: CryptoRouteDto[] }> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.stakingController.getAllStaking(jwt),
      this.cryptoRouteController.getAllCrypto(jwt),
    ]).then(([buy, sell, staking, crypto]) => ({ buy, sell, staking, crypto }));
  }
}
