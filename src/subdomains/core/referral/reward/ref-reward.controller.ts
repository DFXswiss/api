import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { UpdateRefRewardDto } from './dto/update-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
import { RefRewardService } from './services/ref-reward.service';

@ApiTags('reward/ref')
@Controller('reward/ref')
export class RefRewardController {
  constructor(private readonly refRewardService: RefRewardService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async updateVolumes(): Promise<void> {
    return this.refRewardService.updateVolumes();
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async updateRefReward(@Param('id') id: string, @Body() dto: UpdateRefRewardDto): Promise<RefReward> {
    return this.refRewardService.updateRefReward(+id, dto);
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async createPendingRefRewards(): Promise<void> {
    return this.refRewardService.createPendingRefRewards();
  }
}
