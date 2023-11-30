import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateKycStepDto } from '../dto/input/update-kyc-step.dto';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { NameCheckLog } from '../entities/name-check-log.entity';
import { KycAdminService } from '../services/kyc-admin.service';
import { NameCheckService } from '../services/name-check.service';

@ApiTags('Kyc')
@Controller('kyc/admin')
@ApiExcludeController()
export class KycAdminController {
  constructor(private readonly nameCheckService: NameCheckService, private readonly kycService: KycAdminService) {}

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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateKycStep(@Param('id') id: string, @Body() dto: UpdateKycStepDto): Promise<void> {
    await this.kycService.updateKycStep(+id, dto);
  }
}
