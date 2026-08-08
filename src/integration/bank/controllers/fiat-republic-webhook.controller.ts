import { BadRequestException, Controller, ForbiddenException, Headers, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FiatRepublicPaymentResponse, FiatRepublicWebhookPayload } from '../dto/fiat-republic.dto';
import { FiatRepublicWebhookService } from '../services/fiat-republic-webhook.service';
import { FiatRepublicService } from '../services/fiat-republic.service';

@ApiTags('Bank')
@Controller('bank/fiatRepublic')
export class FiatRepublicWebhookController {
  private readonly logger = new DfxLogger(FiatRepublicWebhookController);

  constructor(
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly webhookService: FiatRepublicWebhookService,
  ) {}

  /**
   * Fail-closed on every gate, in this order: the rail must be released (credentials + master flag +
   * bank-tx sync stage + a configured webhook secret), and only then is the signature checked. An
   * environment that has not switched Fiat Republic on rejects every delivery without parsing it —
   * which is exactly what "the service is dead without its environment" has to mean at the edge.
   *
   * Reads the raw body (registered in `main.ts`), because the signature covers the exact bytes sent;
   * a re-serialised `@Body()` object would not reproduce them.
   */
  @Post('webhook')
  @ApiExcludeEndpoint()
  async handleFiatRepublicWebhook(
    @Headers('digest') digest: string,
    @Headers('signature-input') signatureInput: string,
    @Headers('signature') signature: string,
    @Req() req: Request,
  ): Promise<{ received: boolean }> {
    if (!this.fiatRepublicService.isWebhookEnabled()) throw new ForbiddenException('Fiat Republic is not enabled');

    const rawBody: Buffer | string = req.body;
    if (!rawBody?.length) throw new BadRequestException('Empty payload');

    if (!this.webhookService.isValidSignature(rawBody, { digest, signatureInput, signature })) {
      this.logger.warn('Received Fiat Republic webhook with an invalid signature');
      throw new ForbiddenException('Invalid signature');
    }

    let payload: FiatRepublicWebhookPayload<FiatRepublicPaymentResponse>;
    try {
      payload = JSON.parse(rawBody.toString());
    } catch {
      // The body is signed and therefore authentic, but unparseable — never log its content.
      throw new BadRequestException('Malformed payload');
    }

    this.webhookService.processWebhook(payload);

    return { received: true };
  }
}
