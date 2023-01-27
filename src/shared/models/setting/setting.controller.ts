import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CakeFlowDto, CakeSettings } from './dto/cake-flow.dto';
import { CfpSettings } from 'src/subdomains/core/statistic/dto/cfp.dto';
import { FrontendSettings } from './dto/frontend-settings.dto';
import { Setting } from './setting.entity';
import { SettingService } from './setting.service';

@ApiTags('Setting')
@Controller('setting')
@ApiExcludeController()
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get('frontend')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFrontendSettings(): Promise<FrontendSettings> {
    const cfpSettings = await this.settingService.getObj<CfpSettings>('cfp');

    return { cfpVotingOpen: cfpSettings.votingOpen };
  }

  @Get('cake')
  async getCakeSettings(): Promise<CakeSettings> {
    return this.settingService.getObj<CakeSettings>('cake');
  }

  // --- ADMIN --- //
  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getSettings(): Promise<Setting[]> {
    return this.settingService.getAll();
  }

  @Put('cakeFlow')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateCakeFlowSetting(@Body() dto: CakeFlowDto): Promise<void> {
    return this.settingService.setCakeFlow(dto);
  }

  @Put(':key')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateSetting(@Param('key') key: string, @Body() { value }: { value: string }): Promise<void> {
    return this.settingService.set(key, value);
  }
}
