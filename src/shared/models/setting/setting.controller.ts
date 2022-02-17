import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CfpSettings } from 'src/statistic/cfp.service';
import { FrontendSettings } from './dto/frontend-settings.dto';
import { SettingService } from './setting.service';

@ApiTags('setting')
@Controller('setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get()
  @ApiBearerAuth()
  async getFrontendSettings(): Promise<FrontendSettings> {
    const cfpSettings = await this.settingService.getObj<CfpSettings>('cfp');
    
    return { cfpVotingOpen: cfpSettings.votingOpen };
  }
}
