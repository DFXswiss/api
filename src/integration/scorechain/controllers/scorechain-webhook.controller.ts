import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ScorechainAlert } from '../dto/scorechain.dto';
import { ScorechainWebhookGuard } from '../guards/scorechain-webhook.guard';

// Receives TMS scenario alerts pushed by Scorechain (ScenarioAlertCallback). The request is
// authenticated by ScorechainWebhookGuard via the X-Signature proof of authenticity.
@ApiTags('scorechain')
@Controller('scorechain')
export class ScorechainWebhookController {
  private readonly logger = new DfxLogger(ScorechainWebhookController);

  @Post('webhook')
  @ApiExcludeEndpoint()
  @UseGuards(ScorechainWebhookGuard)
  async handleAlert(@Body() alert: ScorechainAlert): Promise<void> {
    this.logger.verbose(`Scorechain TMS alert received: ${JSON.stringify(alert)}`);
    // TODO(spec §12 Q6/Q7): correlate `alert.identifier` to the originating tx and raise the
    // AML manual-review signal (AmlError → CheckStatus.PENDING).
  }
}
