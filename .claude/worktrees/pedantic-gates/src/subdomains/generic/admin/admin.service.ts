import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutOrderContext } from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { PayoutRequest } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayoutRequestContext, PayoutRequestDto } from './dto/payout-request.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly assetService: AssetService,
    private readonly dexService: DexService,
    private readonly payoutService: PayoutService,
    private readonly settingService: SettingService,
  ) {}

  // --- PAYOUT --- //

  async payout(request: PayoutRequestDto): Promise<void> {
    const { context, id, amount, assetId, address } = request;

    const asset = await this.assetService.getAssetById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    const orderExists = await this.dexService.hasOrder(context, id);
    if (orderExists) throw new ConflictException(`${context} order ${id} already exists`);

    const lContext = context as LiquidityOrderContext;
    const pContext = context as PayoutOrderContext;

    const allowedAddresses = await this.settingService.getObj('manualPayoutAddresses', []);
    if (!allowedAddresses.includes(address.toLowerCase()))
      throw new BadRequestException('Payout address not permitted');

    try {
      // reserve liquidity
      const reservationRequest: ReserveLiquidityRequest = {
        context: lContext,
        correlationId: id,
        referenceAmount: amount,
        referenceAsset: asset,
        targetAsset: asset,
      };
      await this.dexService.reserveLiquidity(reservationRequest);

      // payout
      const payoutRequest: PayoutRequest = {
        context: pContext,
        correlationId: id,
        amount: amount,
        asset: asset,
        destinationAddress: address,
      };
      await this.payoutService.doPayout(payoutRequest);
    } catch (e) {
      await this.dexService.cancelOrders(lContext, id);

      throw new ServiceUnavailableException('Exception during payout', { description: e.message });
    }
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_OUT, timeout: 3600 })
  async completeLiquidityOrders() {
    for (const context of Object.values(PayoutRequestContext)) {
      const lContext = context as unknown as LiquidityOrderContext;
      const pContext = context as unknown as PayoutOrderContext;

      const pendingOrders = await this.dexService.getPendingOrders(lContext);
      for (const order of pendingOrders) {
        const { isComplete } = await this.payoutService.checkOrderCompletion(pContext, order);
        if (isComplete) await this.dexService.completeOrders(lContext, order);
      }
    }
  }
}
