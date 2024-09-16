import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateKycLogDto, UpdateKycLogDto } from '../dto/input/create-kyc-log.dto';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { KycWebhookTriggerDto } from '../dto/kyc-webhook-trigger.dto';
import { NameCheckLog } from '../entities/name-check-log.entity';
import { KycAdminService } from '../services/kyc-admin.service';
import { KycLogService } from '../services/kyc-log.service';
import { NameCheckService } from '../services/name-check.service';

@ApiTags('Kyc')
@Controller('kyc/admin')
@ApiExcludeController()
export class KycAdminController {
  constructor(
    private readonly nameCheckService: NameCheckService,
    private readonly kycService: KycAdminService,
    private readonly kycLogService: KycLogService,
  ) {}

  @Put('nameCheck/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateNameCheckLog(@Param('id') id: string, @Body() dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    return this.nameCheckService.updateLog(+id, dto);
  }

  @Put('step/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.SUPPORT))
  async updateKycStep(@Param('id') id: string, @Body() dto: UpdateKycStepDto): Promise<void> {
    await this.kycService.updateKycStep(+id, dto);
  }

  @Put('log/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateLog(@Param('id') id: string, @Body() dto: UpdateKycLogDto): Promise<void> {
    await this.kycLogService.updateLog(+id, dto);
  }

  @Post('webhook')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async triggerWebhook(@Body() dto: KycWebhookTriggerDto): Promise<void> {
    await this.kycService.triggerWebhook(dto);
  }

  @Post('log')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async createLog(@Body() dto: CreateKycLogDto): Promise<void> {
    await this.kycLogService.createLog(dto);
  }
}
