import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { Request } from 'express';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TLSSocket } from 'tls';
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
    const expectedFingerprint = Config.bank.yapeal.webhookCertFingerprint;
    if (!expectedFingerprint) {
      this.logger.warn('No expected certificate fingerprint configured - validation disabled');
      return;
    }

    this.logger.verbose(`Request headers: ${JSON.stringify(Object.keys(req.headers))}`);

    // Try to get certificate from Azure Front Door header
    const certHeader = req.headers['x-arr-clientcert'] as string | undefined;
    let actualFingerprint: string | undefined;

    if (certHeader) {
      this.logger.verbose('Found x-arr-clientcert header');
      try {
        // X-ARR-ClientCert is base64 encoded PEM certificate
        const certPem = Buffer.from(certHeader, 'base64').toString('utf-8');
        actualFingerprint = this.extractFingerprintFromPem(certPem);
        this.logger.info(`Certificate fingerprint from Front Door header: ${actualFingerprint}`);
      } catch (e) {
        this.logger.error('Failed to extract fingerprint from Front Door certificate:', e);
        return;
      }
    } else {
      this.logger.verbose('No x-arr-clientcert header found, checking direct TLS socket');
      // Fallback to direct TLS socket certificate (local development)
      const socket = req.socket as TLSSocket;
      this.logger.verbose(`Socket type: ${socket.constructor.name}`);

      const directCert = socket.getPeerCertificate?.(true);
      this.logger.verbose(`Peer certificate: ${directCert ? JSON.stringify(Object.keys(directCert)) : 'undefined'}`);

      if (directCert && Object.keys(directCert).length > 0) {
        actualFingerprint = directCert.fingerprint;
        this.logger.info(`Certificate fingerprint from direct TLS: ${actualFingerprint}`);
      }
    }

    if (!actualFingerprint) {
      this.logger.warn('No client certificate received');
      return;
    }

    if (actualFingerprint !== expectedFingerprint) {
      this.logger.warn(`Certificate fingerprint mismatch: expected ${expectedFingerprint}, got ${actualFingerprint}`);
      return;
    }

    this.logger.info('Client certificate validated successfully');
  }

  private extractFingerprintFromPem(certPem: string): string {
    const certData = certPem
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s/g, '');

    const certBuffer = Buffer.from(certData, 'base64');

    const fingerprint = crypto.createHash('sha256').update(certBuffer).digest('hex');

    return (
      fingerprint
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.join(':') || fingerprint
    );
  }
}
