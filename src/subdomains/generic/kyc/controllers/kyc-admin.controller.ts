import { Body, Controller, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
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
  ) {}

  @Put('nameCheck/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateNameCheckLog(@Param('id') id: string, @Body() dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    return this.nameCheckService.updateLog(+id, dto);
  }

  @Put('step/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT), UserActiveGuard)
  async updateKycStep(@Param('id') id: string, @Body() dto: UpdateKycStepDto): Promise<void> {
    await this.kycAdminService.updateKycStep(+id, dto);
  }

  @Put('step/:id/ident')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT), UserActiveGuard)
  async syncIdentStep(@Param('id') id: string): Promise<void> {
    await this.kycAdminService.syncIdentStep(+id);
  }

  @Post('webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  @ApiExcludeEndpoint()
  async triggerWebhook(@Body() dto: KycWebhookTriggerDto): Promise<void> {
    await this.kycAdminService.triggerWebhook(dto);
  }

  @Post('log')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  @ApiExcludeEndpoint()
  async createLog(@GetJwt() jwt: JwtPayload, @Body() dto: CreateKycLogDto): Promise<void> {
    await this.kycLogService.createLog(jwt.account, dto);
  }

  @Put('log/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateLog(@Param('id') id: string, @Body() dto: UpdateKycLogDto): Promise<void> {
    await this.kycLogService.updateLog(+id, dto);
  }

  @Post('ident/file/sync')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  @ApiExcludeEndpoint()
  async syncIdentFiles(@Query('step') step: string): Promise<void> {
    return this.kycService.syncIdentFiles(+step);
  }
}
