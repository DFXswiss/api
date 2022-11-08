import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityManagementRuleCreationDto } from '../dto/liquidity-management-rule-creation.dto';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleService } from '../services/liquidity-management-rule.service';

@ApiTags('liquidity-management/rule')
@Controller('liquidity-management/rule')
export class LiquidityManagementRuleController {
  constructor(private readonly service: LiquidityManagementRuleService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async createRule(@Body() dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRule> {
    return this.service.createRule(dto);
  }
}
