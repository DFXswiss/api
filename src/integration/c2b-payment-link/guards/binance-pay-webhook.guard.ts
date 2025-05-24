import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BinancePayService } from '../../c2b-payment-link/services/binance-pay.service';

@Injectable()
export class BinancePayWebhookGuard implements CanActivate {
  constructor(private readonly binancePayService: BinancePayService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const {
      'binancepay-timestamp': timestamp,
      'binancepay-nonce': nonce,
      'binancepay-signature': signature,
      'binancepay-certificate-sn': certSN,
    } = request.headers;

    const isValid = await this.binancePayService.verifySignature(request.body, { timestamp, nonce, signature, certSN });

    if (!isValid) {
      return false;
    }

    return true;
  }
}
