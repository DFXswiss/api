import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RecallDto } from './recall.dto';
import { RecallService } from './recall.service';

@ApiTags('Recall')
@Controller('recall')
export class RecallController {
  constructor(private readonly recallService: RecallService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createRecall(@Body() dto: RecallDto): Promise<void> {
    await this.recallService.create(dto);
  }
}
