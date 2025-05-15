import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateTradingRuleDto } from '../dto/update-trading-rule.dto';
import { TradingRuleService } from '../services/trading-rule.service';

@Controller('trading/rule')
@ApiExcludeController()
export class TradingRuleController {
  constructor(private readonly tradingRuleService: TradingRuleService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateTradingRuleDto): Promise<void> {
    return this.tradingRuleService.updateTradingRule(+id, dto);
  }
}
