import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateTradingRuleDto } from '../dto/update-trading-rule.dto';
import { TradingRule } from '../entities/trading-rule.entity';
import { TradingRuleService } from '../services/trading-rule.service';

@Controller('trading/rule')
@ApiExcludeController()
export class TradingRuleController {
  constructor(private readonly tradingRuleService: TradingRuleService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param() id: string, @Body() dto: UpdateTradingRuleDto): Promise<TradingRule> {
    return this.tradingRuleService.updateTradingRule(+id, dto);
  }
}
