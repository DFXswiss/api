import { Controller, UseGuards, Body, Post, Get, Put, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { LiquidityOrderContext } from './entities/liquidity-order.entity';
import {
  CheckLiquidityRequest,
  CheckLiquidityResult,
  PurchaseLiquidityRequest,
  LiquidityTransactionResult,
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async checkLiquidity(@Query() dto: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.checkLiquidity(dto);
    }
  }

  @Post('reserve-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async reserveLiquidity(@Body() dto: ReserveLiquidityRequest): Promise<number> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.reserveLiquidity(dto);
    }
  }

  @Post('purchase-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async purchaseLiquidity(@Body() dto: PurchaseLiquidityRequest): Promise<void> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.purchaseLiquidity(dto);
    }
  }

  @Post('transfer-liquidity')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async transferLiquidity(@Body() dto: TransferRequest): Promise<string> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.transferLiquidity(dto);
    }
  }

  @Post('transfer-minimal-utxo')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async transferMinimalUtxo(@Query('address') address: string): Promise<string> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.transferMinimalUtxo(address);
    }
  }

  @Get('liquidity-after-purchase')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async fetchTargetLiquidityAfterPurchase(
    @Query('context') context: LiquidityOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<LiquidityTransactionResult> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.fetchLiquidityTransactionResult(context, correlationId);
    }
  }

  @Get('transfer-completion')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async checkTransferCompletion(@Query('transferTxId') transferTxId: string): Promise<boolean> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.checkTransferCompletion(transferTxId);
    }
  }

  @Put('complete-orders')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async completeOrders(
    @Query('context') context: LiquidityOrderContext,
    @Query('correlationId') correlationId: string,
  ): Promise<void> {
    if (process.env.ENVIRONMENT === 'test') {
      return this.dexService.completeOrders(context, correlationId);
    }
  }
}
