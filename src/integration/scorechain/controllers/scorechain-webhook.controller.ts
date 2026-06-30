import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ScorechainAlert } from '../dto/scorechain.dto';

// Receives TMS scenario alerts pushed by Scorechain (ScenarioAlertCallback).
// NOTE: the exact callback authentication scheme must be confirmed with the provider; a
// shared secret header is assumed here. Routing the alert into the AML manual-review flow
// is the open call-site decision (spec §12, Q6/Q7).
@ApiTags('scorechain')
@Controller('scorechain')
export class ScorechainWebhookController {
  private readonly logger = new DfxLogger(ScorechainWebhookController);

  @Post('webhook')
  @ApiExcludeEndpoint()
  async handleAlert(@Headers('x-webhook-secret') secret: string, @Body() alert: ScorechainAlert): Promise<void> {
    if (!Config.scorechain.webhookSecret || secret !== Config.scorechain.webhookSecret) {
      throw new ForbiddenException('Invalid Scorechain webhook secret');
    }

    this.logger.info(`Scorechain TMS alert received: ${JSON.stringify(alert)}`);
    // TODO(spec §12 Q6/Q7): correlate `alert.identifier` to the originating tx and raise the
    // AML manual-review signal (AmlError → CheckStatus.PENDING).
  }
}
