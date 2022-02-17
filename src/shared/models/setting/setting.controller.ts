import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CfpSettings } from 'src/statistic/cfp.service';
import { FrontendSettings } from './dto/frontend-settings.dto';
import { SettingService } from './setting.service';

@ApiTags('setting')
@Controller('setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFrontendSettings(): Promise<FrontendSettings> {
    const cfpSettings = await this.settingService.getObj<CfpSettings>('cfp');

    return { cfpVotingOpen: cfpSettings.votingOpen };
  }
}
