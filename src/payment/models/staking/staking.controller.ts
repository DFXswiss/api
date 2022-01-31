import { Body, Controller, Get, Put, UseGuards, Post, Query, Param, NotFoundException } from '@nestjs/common';
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
import { CryptoInputService } from 'src/payment/models/crypto-input/crypto-input.service';

@ApiTags('staking')
@Controller('staking')
export class StakingController {
  constructor(
    private readonly stakingService: StakingService,
    private readonly cryptoInputService: CryptoInputService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllStaking(@GetJwt() jwt: JwtPayload): Promise<StakingDto[]> {
    return this.stakingService.getUserStaking(jwt.id).then((l) => this.stakingService.toDtoList(jwt.id, l));
  }

  @Get(':address')
  async getStakingVolume(@Param('address') address: string): Promise<number> {
    const stakingIds = await this.stakingService.getStakingByAddress(address);
    if (stakingIds.length === 0) throw new NotFoundException('No DFX staking');
    const stakingBalances = (
      await this.cryptoInputService.getAllStakingBalance(
        stakingIds.map((u) => u.id),
        new Date(),
      )
    ).reduce((sum, current) => sum + current.balance, 0);
    return stakingBalances;
  }

  @Get('balance')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllStakingBalance(@Query('date') date: Date = new Date()): Promise<{ id: number; balance: number }[]> {
    const stakingIds = await this.stakingService.getAllIds();
    return this.cryptoInputService.getAllStakingBalance(stakingIds, date);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createStaking(@GetJwt() jwt: JwtPayload, @Body() createStakingDto: CreateStakingDto): Promise<StakingDto> {
    return this.stakingService
      .createStaking(jwt.id, createStakingDto)
      .then((s) => this.stakingService.toDto(jwt.id, s));
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateStaking(@GetJwt() jwt: JwtPayload, @Body() updateStakingDto: UpdateStakingDto): Promise<StakingDto> {
    return this.stakingService
      .updateStaking(jwt.id, updateStakingDto)
      .then((s) => this.stakingService.toDto(jwt.id, s));
  }
}
