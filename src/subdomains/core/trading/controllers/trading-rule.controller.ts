import { Controller, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TradingOrderOutputDto } from '../dto/output/trading-order-output.dto';
import { TradingRuleOutputDto } from '../dto/output/trading-rule-output.dto';
import { TradingRuleService } from '../services/trading-rule.service';

@ApiTags('Trading')
@Controller('trading/rule')
export class TradingRuleController {
  constructor(private tradingRuleService: TradingRuleService) {}

  @Patch(':id/process')
  //  @ApiBearerAuth()
  //  @ApiExcludeEndpoint()
  //  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async processRule(@Param('id') id: number): Promise<TradingOrderOutputDto> {
    return this.tradingRuleService.processRule(id);
  }

  @Patch(':id/deactivate')
  //  @ApiBearerAuth()
  //  @ApiExcludeEndpoint()
  //  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async deactivateRule(@Param('id') id: number): Promise<TradingRuleOutputDto> {
    return this.tradingRuleService.deactivateRule(id);
  }

  @Patch(':id/reactivate')
  //  @ApiBearerAuth()
  //  @ApiExcludeEndpoint()
  //  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async reactivateRule(@Param('id') id: number): Promise<TradingRuleOutputDto> {
    return this.tradingRuleService.reactivateRule(id);
  }
}
