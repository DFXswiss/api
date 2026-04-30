import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config, Environment } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityOrderContext } from './entities/liquidity-order.entity';
import {
  CheckLiquidityRequest,
  CheckLiquidityResult,
  LiquidityTransactionResult,
  PurchaseLiquidityRequest,
  ReserveLiquidityRequest,
  TransferRequest,
} from './interfaces';
import { DexService } from './services/dex.service';

@ApiTags('dex')
@Controller('dex')
export class DexController {
  constructor(private readonly dexService: DexService) {}

  @Get('check-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async checkLiquidity(@Query() dto: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.checkLiquidity(dto);
    }
  }

  @Post('reserve-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async reserveLiquidity(@Body() dto: ReserveLiquidityRequest): Promise<number> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.reserveLiquidity(dto);
    }
  }

  @Post('purchase-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async purchaseLiquidity(@Body() dto: PurchaseLiquidityRequest): Promise<void> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.purchaseLiquidity(dto);
    }
  }

  @Post('transfer-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async transferLiquidity(@Body() dto: TransferRequest): Promise<string> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.transferLiquidity(dto);
    }
  }

  @Get('liquidity-after-purchase')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async fetchTargetLiquidityAfterPurchase(
    @Query('context') context: LiquidityOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<LiquidityTransactionResult> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.fetchLiquidityTransactionResult(context, correlationId);
    }
  }

  @Get('transfer-completion')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async checkTransferCompletion(
    @Query('transferTxId') transferTxId: string,
    @Query('blockchain') blockchain: Blockchain,
  ): Promise<boolean> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.checkTransferCompletion(transferTxId, blockchain);
    }
  }

  @Put('complete-orders')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async completeOrders(
    @Query('context') context: LiquidityOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<void> {
    if (Config.environment !== Environment.PRD) {
      return this.dexService.completeOrders(context, correlationId);
    }
  }
}
