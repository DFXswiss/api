import { Controller, UseGuards, Put, Body, Param, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateRefRewardDto } from './dto/create-ref-reward.dto';
import { UpdateRefRewardDto } from './dto/update-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
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

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateRefRewardDto): Promise<RefReward> {
    return this.refRewardService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateRefRewardDto): Promise<RefReward> {
    return this.refRewardService.update(+id, dto);
  }
}
