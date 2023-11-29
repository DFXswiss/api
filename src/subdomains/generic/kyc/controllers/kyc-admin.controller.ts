import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateKycStepStatusDto } from '../dto/input/update-kyc-step-status.dtp';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { NameCheckLog } from '../entities/name-check-log.entity';
import { KycService } from '../services/kyc.service';
import { NameCheckService } from '../services/name-check.service';

@ApiTags('Kyc')
@Controller('kyc/admin')
@ApiExcludeController()
export class KycAdminController {
  constructor(private readonly nameCheckLogService: NameCheckService, private readonly kycService: KycService) {}

  @Put('nameCheck/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateNameCheckLog(@Param('id') id: string, @Body() dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    return this.nameCheckLogService.updateLog(+id, dto);
  }

  @Put('kycStep/:id/status')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateKycStep(@Param('id') id: string, @Body() dto: UpdateKycStepStatusDto): Promise<void> {
    await this.kycService.updateKycStep(+id, dto);
  }
}
