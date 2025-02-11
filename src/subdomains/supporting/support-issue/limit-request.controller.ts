import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { UpdateLimitRequestDto } from './dto/update-limit-request.dto';
import { LimitRequest } from './entities/limit-request.entity';
import { LimitRequestService } from './services/limit-request.service';

@ApiTags('limitRequest')
@Controller('limitRequest')
@ApiExcludeController()
export class LimitRequestController {
  constructor(private readonly limitRequestService: LimitRequestService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async updateUserData(@Param('id') id: string, @Body() dto: UpdateLimitRequestDto): Promise<LimitRequest> {
    return this.limitRequestService.updateLimitRequest(+id, dto);
  }
}
