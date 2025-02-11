import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserGuard } from 'src/shared/auth/user.guard';
import { LiquidityManagementRequestDto } from '../dto/input/liquidity-management-request.dto';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';
import { LiquidityManagementPipelineStatus } from '../enums';
import { PipelineId } from '../interfaces';
import { LiquidityManagementPipelineService } from '../services/liquidity-management-pipeline.service';
import { LiquidityManagementService } from '../services/liquidity-management.service';

@ApiTags('liquidityManagement')
@Controller('liquidityManagement/pipeline')
export class LiquidityManagementPipelineController {
  constructor(
    private readonly lmService: LiquidityManagementService,
    private readonly pipelineService: LiquidityManagementPipelineService,
  ) {}

  @Post('buy')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async buyLiquidity(@Body() dto: LiquidityManagementRequestDto): Promise<PipelineId> {
    const { assetId, amount, targetOptimal } = dto;

    return this.lmService.buyLiquidity(assetId, amount, targetOptimal);
  }

  @Post('sell')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async sellLiquidity(@Body() dto: LiquidityManagementRequestDto): Promise<PipelineId> {
    const { assetId, amount, targetOptimal } = dto;

    return this.lmService.sellLiquidity(assetId, amount, targetOptimal);
  }

  @Get(':id/status')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async getPipelineStatus(@Param('id') id: number): Promise<LiquidityManagementPipelineStatus> {
    return this.pipelineService.getPipelineStatus(id);
  }

  @Get('in-progress')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async getProcessingPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineService.getProcessingPipelines();
  }

  @Get('stopped')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserGuard)
  async getStoppedPipelines(): Promise<LiquidityManagementPipeline[]> {
    return this.pipelineService.getStoppedPipelines();
  }
}
