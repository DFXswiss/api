import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ScorechainScreeningQuery } from '../dto/scorechain-query.dto';
import { ScorechainScreening } from '../entities/scorechain-screening.entity';
import { ScorechainScreeningService } from '../services/scorechain-screening.service';

@ApiTags('scorechain')
@Controller('scorechain')
export class ScorechainController {
  constructor(private readonly screeningService: ScorechainScreeningService) {}

  @Post('screening')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async screen(@Query() query: ScorechainScreeningQuery): Promise<ScorechainScreening> {
    return this.screeningService.screenManual(query.blockchain, query.objectId, query.objectType, query.analysisType);
  }
}
