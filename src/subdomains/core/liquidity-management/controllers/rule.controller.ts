import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityManagementRuleCreationDto } from '../dto/input/liquidity-management-rule-creation.dto';
import { LiquidityManagementRuleOutputDto } from '../dto/output/liquidity-management-rule-output.dto';
import { LiquidityManagementRuleService } from '../services/liquidity-management-rule.service';

@ApiTags('liquidityManagement')
@Controller('liquidityManagement/rule')
export class LiquidityManagementRuleController {
  constructor(private readonly service: LiquidityManagementRuleService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async createRule(@Body() dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.createRule(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRule(
    @Param('id') id: number,
    @Body() dto: LiquidityManagementRuleCreationDto,
  ): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.updateRule(id, dto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.getRule(id);
  }

  @Patch(':id/deactivate')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async deactivateRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.deactivateRule(id);
  }

  @Patch(':id/reactivate')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async reactivateRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.reactivateRule(id);
  }
}
