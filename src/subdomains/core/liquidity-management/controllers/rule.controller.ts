import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityManagementRuleCreationDto } from '../dto/input/liquidity-management-rule-creation.dto';
import { LiquidityManagementRuleSettingsDto } from '../dto/input/liquidity-management-settings.dto';
import { LiquidityManagementRuleUpdateDto } from '../dto/input/liquidity-management-update.dto';
import { LiquidityManagementRuleOutputDto } from '../dto/output/liquidity-management-rule-output.dto';
import { LiquidityManagementRuleService } from '../services/liquidity-management-rule.service';

@ApiTags('liquidityManagement')
@Controller('liquidityManagement/rule')
export class LiquidityManagementRuleController {
  constructor(private readonly service: LiquidityManagementRuleService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async createRule(@Body() dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.createRule(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateRule(@Param('id') id: number, @Body() dto: LiquidityManagementRuleUpdateDto): Promise<void> {
    return this.service.updateRule(id, dto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async getRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.getRule(id);
  }

  @Patch(':id/deactivate')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async deactivateRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.deactivateRule(id);
  }

  @Patch(':id/reactivate')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async reactivateRule(@Param('id') id: number): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.reactivateRule(id);
  }

  @Patch(':id/settings')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async setReactivationTime(
    @Param('id') id: number,
    @Body() dto: LiquidityManagementRuleSettingsDto,
  ): Promise<LiquidityManagementRuleOutputDto> {
    return this.service.updateRuleSettings(id, dto);
  }
}
