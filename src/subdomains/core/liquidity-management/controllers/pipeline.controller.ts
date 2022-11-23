import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementPipelineService } from '../services/liquidity-management-pipeline.service';

@ApiTags('liquidityManagement')
@Controller('liquidityManagement/pipeline')
export class LiquidityManagementPipelineController {
  constructor(private readonly service: LiquidityManagementPipelineService) {}

  @Get('in-progress')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getProcessingPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.service.getProcessingPipelines();
  }

  @Get('stopped')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getStoppedPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.service.getStoppedPipelines();
  }
}
