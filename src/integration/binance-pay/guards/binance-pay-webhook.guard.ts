import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BinancePayService } from '../binance-pay.service';

@Injectable()
export class BinancePayWebhookGuard implements CanActivate {
  constructor(private readonly binancePayService: BinancePayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const isValid = await this.binancePayService.verifyWebhook(request.body, request.headers);

    if (!isValid) {
      return false;
    }

    return true;
  }
}
