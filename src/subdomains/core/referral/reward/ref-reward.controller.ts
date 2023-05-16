import { Controller, UseGuards, Put } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RefRewardService } from './ref-reward.service';

@ApiTags('reward/ref')
@Controller('reward/ref')
export class RefRewardController {
  constructor(private readonly refRewardService: RefRewardService) {}

  @Put('volumes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateVolumes(): Promise<void> {
    return this.refRewardService.updateVolumes();
  }
}
