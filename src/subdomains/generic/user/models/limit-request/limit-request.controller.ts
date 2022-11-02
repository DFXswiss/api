import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateLimitRequestDto } from './dto/update-limit-request.dto';
import { LimitRequest } from './limit-request.entity';
import { LimitRequestService } from './limit-request.service';

@ApiTags('limitRequest')
@Controller('limitRequest')
export class LimitRequestController {
  constructor(private readonly limitRequestService: LimitRequestService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateUserData(@Param('id') id: string, @Body() dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    return this.limitRequestService.updateLimitRequest(+id, dto);
  }
}
