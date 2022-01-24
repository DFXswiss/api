import { Body, Controller, Get, Put, UseGuards, Post, Param, Query } from '@nestjs/common';
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
    return this.stakingService
      .getAllStaking(jwt.id)
      .then((l) => Promise.all(l.map((s) => this.stakingService.toDto(s))));
  }

  @Get('balance')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllStakingBalance(@Query('date') date: Date = new Date()): Promise<{ id: number; balance: number }[]> {
    return this.cryptoInputService.getAllStakingBalance(date);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createStaking(@GetJwt() jwt: JwtPayload, @Body() createStakingDto: CreateStakingDto): Promise<StakingDto> {
    return this.stakingService.createStaking(jwt.id, createStakingDto).then((s) => this.stakingService.toDto(s));
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateStaking(@GetJwt() jwt: JwtPayload, @Body() updateStakingDto: UpdateStakingDto): Promise<StakingDto> {
    return this.stakingService.updateStaking(jwt.id, updateStakingDto).then((s) => this.stakingService.toDto(s));
  }
}
