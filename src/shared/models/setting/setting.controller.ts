import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CustomSignUpFeesDto } from './dto/custom-sign-up-fees.dto';
import { InfoBannerDto, InfoBannerSetting } from './dto/info-banner.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import { Setting } from './setting.entity';
import { SettingService } from './setting.service';

@ApiTags('Setting')
@Controller('setting')
@ApiExcludeController()
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get('infoBanner')
  @ApiOkResponse({ type: InfoBannerDto })
  async getInfoBanner(): Promise<InfoBannerDto> {
    const banner = await this.settingService.getObj<InfoBannerSetting>('infoBanner', undefined);
    if (banner && new Date() > new Date(banner.from) && new Date() < new Date(banner.to)) return banner.content;
  }

  // --- ADMIN --- //
  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async getSettings(): Promise<Setting[]> {
    return this.settingService.getAll();
  }

  @Put('customSignUpFees')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateCustomSignUpFees(@Body() dto: CustomSignUpFeesDto): Promise<void> {
    return this.settingService.updateCustomSignUpFees(dto);
  }

  @Put('disabledProcesses')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateProcess(@Body() dto: UpdateProcessDto): Promise<void> {
    return this.settingService.updateProcess(dto);
  }

  @Put(':key')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateSetting(@Param('key') key: string, @Body() { value }: { value: string }): Promise<void> {
    return this.settingService.set(key, value);
  }
}
