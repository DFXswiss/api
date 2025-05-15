import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PayoutOrderContext } from './entities/payout-order.entity';
import { PayoutRequest } from './interfaces';
import { PayoutService } from './services/payout.service';

@ApiTags('payout')
@Controller('payout')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async doPayout(@Body() dto: PayoutRequest): Promise<void> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.payoutService.doPayout(dto);
    }
  }

  @Get('completion')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async checkOrderCompletion(
    @Query('context') context: PayoutOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<{ isComplete: boolean; payoutTxId: string }> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.payoutService.checkOrderCompletion(context, correlationId);
    }
  }

  @Post('speedup')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async speedupTransaction(@Query('id') id: string): Promise<void> {
    return this.payoutService.speedupTransaction(+id);
  }
}
