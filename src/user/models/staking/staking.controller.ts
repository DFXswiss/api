import { Body, Controller, Get, Put, UseGuards, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { StakingService } from './staking.service';
import { Staking } from './staking.entity';
import { CreateStakingDto } from './dto/create-staking.dto';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { StakingType } from './dto/staking-type.enum';
import { StakingDto } from './dto/staking.dto';
import { SellRepository } from '../sell/sell.repository';
import { Sell } from '../sell/sell.entity';

@ApiTags('staking')
@Controller('staking')
export class StakingController {
  constructor(private readonly stakingService: StakingService, private readonly sellRepo: SellRepository) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllStaking(@GetJwt() jwt: JwtPayload): Promise<StakingDto[]> {
    return this.stakingService.getAllStaking(jwt.id).then((l) => Promise.all(l.map((s) => this.toDto(s))));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createStaking(@GetJwt() jwt: JwtPayload, @Body() createStakingDto: CreateStakingDto): Promise<StakingDto> {
    return this.stakingService.createStaking(jwt.id, createStakingDto).then((s) => this.toDto(s));
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateStaking(@GetJwt() jwt: JwtPayload, @Body() updateStakingDto: UpdateStakingDto): Promise<StakingDto> {
    return this.stakingService.updateStaking(jwt.id, updateStakingDto).then((s) => this.toDto(s));
  }

  private async toDto(staking: Staking): Promise<StakingDto> {
    const rewardType = this.getStakingType(staking.rewardDeposit?.id, staking.deposit.id);
    const paybackType = this.getStakingType(staking.paybackDeposit?.id, staking.deposit.id);

    return {
      id: staking.id,
      active: staking.active,
      deposit: staking.deposit,
      rewardType,
      rewardSell: await this.getSell(rewardType, staking.rewardDeposit?.id),
      paybackType,
      paybackSell: await this.getSell(paybackType, staking.paybackDeposit?.id),
    };
  }

  private getStakingType(typeDepositId: number | undefined, depositId: number): StakingType {
    return typeDepositId
      ? typeDepositId === depositId
        ? StakingType.REINVEST
        : StakingType.PAYOUT
      : StakingType.CREDIT;
  }

  private async getSell(stakingType: StakingType, depositId: number): Promise<Sell | undefined> { // TODO: improve performance?
    return stakingType === StakingType.PAYOUT
      ? await this.sellRepo.findOne({ where: { deposit: { id: depositId } } })
      : undefined;
  }
}
