import { Controller, UseGuards, Put, Body, Param, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateStakingRewardDto } from './dto/create-staking-reward.dto';
import { UpdateStakingRewardDto } from './dto/update-staking-reward.dto';
import { StakingReward } from './staking-reward.entity';
import { StakingRewardService } from './staking-reward.service';

@ApiTags('reward/staking')
@Controller('reward/staking')
export class StakingRewardController {
  constructor(private readonly stakingRewardService: StakingRewardService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.stakingRewardService.updateVolumes();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateStakingRewardDto): Promise<StakingReward> {
    return this.stakingRewardService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateStakingRewardDto): Promise<StakingReward> {
    return this.stakingRewardService.update(+id, dto);
  }
}
