import { Body, Controller, Get, Put, UseGuards, Post, Query, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingService } from './staking.service';
import { CreateStakingDto } from './dto/create-staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { StakingDto } from './dto/staking.dto';
import { Util } from 'src/shared/util';
import { CryptoStakingService } from '../crypto-staking/crypto-staking.service';
import { StakingBatchDto } from '../crypto-staking/dto/staking-batch.dto';

@ApiTags('staking')
@Controller('staking')
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

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createStaking(@GetJwt() jwt: JwtPayload, @Body() createStakingDto: CreateStakingDto): Promise<StakingDto> {
    return this.stakingService
      .createStaking(jwt.id, createStakingDto)
      .then((s) => this.stakingService.toDto(jwt.id, s));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateStaking(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateStakingDto: UpdateStakingDto,
  ): Promise<StakingDto> {
    return this.stakingService
      .updateStaking(jwt.id, +id, updateStakingDto)
      .then((s) => this.stakingService.toDto(jwt.id, s));
  }

  // --- ADMIN --- //
  @Get('balance')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllStakingBalance(@Query('date') date?: Date): Promise<{ id: number; balance: number }[]> {
    const stakingIds = await this.stakingService.getAllIds();
    const balances = await this.stakingService.getAllStakingBalance(stakingIds, date);
    return stakingIds.map((id) => ({ id, balance: balances.find((b) => b.id === id)?.balance ?? 0 }));
  }

  @Get('balance/:address')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.DEFICHAIN_INCOME))
  async getStakingBalance(@Param('address') address: string): Promise<number> {
    const stakingRoutes = await this.stakingService.getUserStakingByAddress(address);
    if (stakingRoutes.length === 0) return 0;

    const stakingBalances = await this.stakingService.getAllStakingBalance(stakingRoutes.map((u) => u.id));
    return Util.round(Util.sumObj(stakingBalances, 'balance'), 8);
  }
}
