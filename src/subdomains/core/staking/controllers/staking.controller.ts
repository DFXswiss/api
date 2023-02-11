import { Controller, Get, UseGuards, Query, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { StakingBatchDto } from '../dto/staking-batch.dto';
import { StakingDto } from '../dto/staking.dto';
import { CryptoStakingService } from '../services/crypto-staking.service';
import { StakingService } from '../services/staking.service';

@ApiTags('Staking')
@Controller('staking')
@ApiExcludeController()
export class StakingController {
  constructor(
    private readonly stakingService: StakingService,
    private readonly cryptoStakingService: CryptoStakingService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllStaking(@GetJwt() jwt: JwtPayload): Promise<StakingDto[]> {
    return this.stakingService.getUserStaking(jwt.id).then((l) => this.stakingService.toDtoList(jwt.id, l));
  }

  @Get(':id/batches')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getActiveBatches(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<StakingBatchDto[]> {
    return this.cryptoStakingService.getActiveBatches(jwt.id, +id);
  }

  // --- SERVICES --- //

  @Get('routes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async getStakingRoutes(@Query('addresses') addresses: string): Promise<string[]> {
    const stakingRoutes = await this.stakingService.getStakingByUserAddresses(addresses.split(','));
    return stakingRoutes.map((r) => r.deposit.address);
  }

  @Get('income')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.DEFICHAIN_INCOME))
  async getStakingBalances(@Query('addresses') addresses: string): Promise<{ totalAmount: number }> {
    const stakingRoutes = await this.stakingService.getStakingByUserAddresses(addresses.split(','));
    return { totalAmount: Util.round(Util.sumObj(stakingRoutes, 'volume'), 8) };
  }

  @Get('routeBalance')
  async getStakingBalance(@Query('addresses') addresses: string): Promise<{ totalAmount: number }> {
    const stakingRoutes = await this.stakingService.getStakingByDepositAddresses(addresses.split(','));
    return { totalAmount: Util.round(Util.sumObj(stakingRoutes, 'volume'), 8) };
  }

  // --- ADMIN --- //
  @Get('balance')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllStakingBalance(@Query('date') date?: Date): Promise<{ id: number; balance: number }[]> {
    const stakingIds = await this.stakingService.getAllIds();
    const balances = await this.stakingService.getAllStakingBalance(date);
    return stakingIds.map((id) => ({ id, balance: balances.find((b) => b.id === id)?.balance ?? 0 }));
  }
}
