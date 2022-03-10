import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CfpSettings } from 'src/statistic/cfp.service';
import { FrontendSettings } from './dto/frontend-settings.dto';
import { Setting } from './setting.entity';
import { SettingService } from './setting.service';

@ApiTags('setting')
@Controller('setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get('frontend')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFrontendSettings(): Promise<FrontendSettings> {
    const cfpSettings = await this.settingService.getObj<CfpSettings>('cfp');

    return { cfpVotingOpen: cfpSettings.votingOpen };
  }

  // --- ADMIN --- //
  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSettings(): Promise<Setting[]> {
    return this.settingService.getAll();
  }

  @Put(':key')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateSetting(@Param('key') key: string, @Body() { value }: { value: string }): Promise<void> {
    return this.settingService.set(key, value);
  }
}
