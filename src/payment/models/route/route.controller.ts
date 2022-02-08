import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingDto } from '../staking/dto/staking.dto';
import { StakingController } from '../staking/staking.controller';
import { BuyController } from '../buy/buy.controller';
import { SellController } from '../sell/sell.controller';
import { SellDto } from '../sell/dto/sell.dto';
import { BuyDto } from '../buy/dto/buy.dto';

@ApiTags('route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly stakingController: StakingController,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllRoutes(@GetJwt() jwt: JwtPayload): Promise<{ buy: BuyDto[]; sell: SellDto[]; staking: StakingDto[] }> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.stakingController.getAllStaking(jwt),
    ]).then(([buy, sell, staking]) => ({ buy, sell, staking }));
  }
}
