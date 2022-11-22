import { Controller, UseGuards, Put, Body, Param, Get, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CryptoStaking } from './crypto-staking.entity';
import { CryptoStakingService } from './crypto-staking.service';
import { GetPayoutsCryptoStakingDto } from './dto/get-payouts-crypto-staking.dto';
import { PayoutCryptoStakingDto } from './dto/payout-crypto-staking.dto';
import { ReadyCryptoStakingDto } from './dto/ready-crypto-staking.dto';
import { StakingBatchDto } from './dto/staking-batch.dto';
import { UpdateCryptoStakingDto } from './dto/update-crypto-staking.dto';
import { UpdateOutputDateDto } from './dto/update-output-date.dto';

@ApiTags('cryptoStaking')
@Controller('cryptoStaking')
export class CryptoStakingController {
  constructor(private readonly cryptoStakingService: CryptoStakingService) {}

  // --- MASTERNODE OPERATOR --- //
  @Get('forecast')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async getPayoutForecast(@Query('date') date: string): Promise<{ batches: StakingBatchDto[]; avgInflow: number }> {
    return this.cryptoStakingService.getPayoutForecast(new Date(date));
  }

  @Get('ready')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async getReadyPayouts(): Promise<GetPayoutsCryptoStakingDto[]> {
    return this.cryptoStakingService.getReadyPayouts();
  }

  @Get('pending')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async getPendingPayouts(@Query('date') date: string): Promise<GetPayoutsCryptoStakingDto[]> {
    return this.cryptoStakingService.getPendingPayouts(new Date(date));
  }

  @Put('ready')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async ready(@Body() dto: ReadyCryptoStakingDto): Promise<void> {
    await this.cryptoStakingService.ready(dto);
  }

  @Put('payout')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.MASTERNODE_OPERATOR))
  async payout(@Body() dto: PayoutCryptoStakingDto[]): Promise<void> {
    await this.cryptoStakingService.payout(dto);
  }

  // --- ADMIN --- //
  @Put('outputDates')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async rearrangeOutputDates(@Query('date') date: string, @Query('maxBatchSize') maxBatchSize?: string): Promise<void> {
    await this.cryptoStakingService.rearrangeOutputDates(new Date(date), maxBatchSize ? +maxBatchSize : undefined);
  }

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.cryptoStakingService.updateVolumes();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    return this.cryptoStakingService.update(+id, dto);
  }

  @Put(':id/manualPayout')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async manualPayout(@Param('id') id: string, @Body() dto: UpdateOutputDateDto): Promise<CryptoStaking> {
    return await this.cryptoStakingService.manualPayout(+id, dto);
  }
}
