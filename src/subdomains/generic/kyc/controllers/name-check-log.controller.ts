import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateNameCheckLogDto } from '../dto/update-name-check-log.dto';
import { NameCheckLog } from '../entities/name-check-log.entity';
import { NameCheckService } from '../services/name-check-log.service';

@ApiTags('Kyc')
@Controller('kyc/admin')
@ApiExcludeController()
export class KycAdminController {
  constructor(private readonly nameCheckLogService: NameCheckService) {}

  @Put('nameCheck/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateNameCheckLog(@Param('id') id: string, @Body() dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    return this.nameCheckLogService.updateLog(+id, dto);
  }
}
