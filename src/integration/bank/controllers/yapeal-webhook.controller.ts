import { Body, Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TLSSocket } from 'tls';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { YapealWebhookService } from '../services/yapeal-webhook.service';

@ApiTags('Bank')
@Controller('bank/yapeal')
export class YapealWebhookController {
  private readonly logger = new DfxLogger(YapealWebhookController);

  constructor(private readonly yapealWebhookService: YapealWebhookService) {}

  @Post('webhook')
  @ApiExcludeEndpoint()
  handleYapealWebhook(@Req() req: Request, @Body() payload: any): { received: boolean } {
    this.validateClientCertificate(req);

    this.yapealWebhookService.processWebhook(payload);
    return { received: true };
  }

  private validateClientCertificate(req: Request): void {
    const socket = req.socket as TLSSocket;
    const clientCert = socket.getPeerCertificate?.(true);

    // Log incoming request details for debugging mTLS setup
    this.logger.info(`Webhook request from ${req.ip}, cert present: ${!!clientCert && Object.keys(clientCert).length > 0}`);

    if (!clientCert || Object.keys(clientCert).length === 0) {
      // TODO: Re-enable after Azure mTLS is configured and Yapeal provides their certificate
      this.logger.warn('No client certificate received - mTLS validation temporarily disabled');
      return;
    }

    const expectedFingerprint = Config.bank.yapeal.webhookCertFingerprint;
    const actualFingerprint = clientCert.fingerprint;

    this.logger.info(`Client certificate fingerprint: ${actualFingerprint}`);

    if (expectedFingerprint) {
      if (actualFingerprint !== expectedFingerprint) {
        throw new ForbiddenException('Invalid client certificate');
      }
    }
  }
}
