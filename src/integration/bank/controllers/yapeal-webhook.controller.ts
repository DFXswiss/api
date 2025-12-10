import { Body, Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TLSSocket } from 'tls';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { YapealWebhookPayloadDto } from '../dto/yapeal-webhook.dto';
import { YapealWebhookService } from '../services/yapeal-webhook.service';

@ApiTags('Bank')
@Controller('bank/yapeal')
export class YapealWebhookController {
  private readonly logger = new DfxLogger(YapealWebhookController);

  constructor(private readonly yapealWebhookService: YapealWebhookService) {}

  @Post('webhook')
  @ApiExcludeEndpoint()
  handleYapealWebhook(@Req() req: Request, @Body() payload: YapealWebhookPayloadDto): { received: boolean } {
    this.validateClientCertificate(req);

    this.yapealWebhookService.processWebhook(payload);
    return { received: true };
  }

  private validateClientCertificate(req: Request): void {
    const socket = req.socket as TLSSocket;
    const clientCert = socket.getPeerCertificate?.(true);

    if (!clientCert || Object.keys(clientCert).length === 0) {
      throw new ForbiddenException('Client certificate required');
    }

    const expectedFingerprint = Config.bank.yapeal.webhookCertFingerprint;
    const actualFingerprint = clientCert.fingerprint;

    if (expectedFingerprint) {
      if (actualFingerprint !== expectedFingerprint) {
        throw new ForbiddenException('Invalid client certificate');
      }
    } else {
      this.logger.info(`No webhook certificate fingerprint configured. Incoming fingerprint: ${actualFingerprint}`);
    }
  }
}
