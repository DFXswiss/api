import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateKycLogDto } from '../dto/update-kyc-log.dto';
import { KycLog } from '../entities/kyc-log.entity';
import { KycLogService } from '../services/kyc-log.service';

@ApiTags('KycLog')
@ApiExcludeController()
@Controller('kycLog')
export class BankDataController {
  constructor(private readonly kycLogService: KycLogService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateKycLog(@Param('id') id: string, @Body() dto: UpdateKycLogDto): Promise<KycLog> {
    return this.kycLogService.update(+id, dto);
  }
}
