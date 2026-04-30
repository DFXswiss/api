import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { KucoinPayService } from './kucoin-pay.service';

@Injectable()
export class KucoinPayWebhookGuard implements CanActivate {
  constructor(private readonly kucoinPayService: KucoinPayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    return this.kucoinPayService.verifySignature(request.body, request.headers);
  }
}
