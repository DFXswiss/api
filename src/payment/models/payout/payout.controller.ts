import { Controller, UseGuards, Body, Post, Get, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PayoutService } from './services/payout.service';
import { PayoutRequest } from './interfaces';
import { PayoutOrderContext } from './entities/payout-order.entity';

@ApiTags('payout')
@Controller('payout')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async doPayout(@Body() dto: PayoutRequest): Promise<void> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.payoutService.doPayout(dto);
    }
  }

  @Get('completion')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async checkOrderCompletion(
    @Query('context') context: PayoutOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<{ isComplete: boolean; payoutTxId: string }> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.payoutService.checkOrderCompletion(context, correlationId);
    }
  }
}
