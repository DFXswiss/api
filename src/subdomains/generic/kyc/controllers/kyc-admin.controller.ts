import { Body, Controller, Delete, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { IpBlacklistDto } from 'src/shared/models/setting/dto/ip-blacklist.dto';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { CreateKycLogDto, UpdateKycLogDto } from '../dto/input/create-kyc-log.dto';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { NameCheckLog } from '../entities/name-check-log.entity';
import { KycAdminService } from '../services/kyc-admin.service';
import { KycLogService } from '../services/kyc-log.service';
import { KycService } from '../services/kyc.service';
import { NameCheckService } from '../services/name-check.service';

@ApiTags('Kyc')
@Controller('kyc/admin')
@ApiExcludeController()
export class KycAdminController {
  constructor(
    private readonly nameCheckService: NameCheckService,
    private readonly kycAdminService: KycAdminService,
    private readonly kycService: KycService,
    private readonly kycLogService: KycLogService,
    private readonly settingService: SettingService,
    private readonly userDataService: UserDataService,
  ) {}

  @Put('nameCheck/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateNameCheckLog(@Param('id') id: string, @Body() dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    return this.nameCheckService.updateLog(+id, dto);
  }

  @Put('step/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  async updateKycStep(@Param('id') id: string, @Body() dto: UpdateKycStepDto): Promise<void> {
    await this.kycAdminService.updateKycStep(+id, dto);
  }

  @Put('blacklist/ip')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async addIpToBlacklist(@Body() dto: IpBlacklistDto): Promise<void> {
    await this.settingService.addIpToBlacklist(dto.ip);

    // update userData
    await this.userDataService.setCheckIpRisk(dto.ip);
  }

  @Delete('blacklist/ip')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async deleteIpToBlacklist(@Body() dto: IpBlacklistDto): Promise<void> {
    return this.settingService.deleteIpFromBlacklist(dto.ip);
  }

  @Post('webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async triggerWebhook(@Body() dto: KycWebhookTriggerDto): Promise<void> {
    await this.kycAdminService.triggerWebhook(dto);
  }

  @Post('log')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.SUPPORT), UserActiveGuard())
  @ApiExcludeEndpoint()
  async createLog(@GetJwt() jwt: JwtPayload, @Body() dto: CreateKycLogDto): Promise<void> {
    await this.kycLogService.createLog(jwt.account, dto);
  }

  @Put('log/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateLog(@Param('id') id: string, @Body() dto: UpdateKycLogDto): Promise<void> {
    await this.kycLogService.updateLog(+id, dto);
  }

  @Post('ident/file/sync')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async syncIdentFiles(@Query('step') step: string): Promise<void> {
    return this.kycService.syncIdentFiles(+step);
  }
}
