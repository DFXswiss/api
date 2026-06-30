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
    // Fail loud: until the TODO below is implemented an incoming alert is NOT acted on. Warn (not
    // verbose) so an accidentally armed TMS path surfaces instead of silently dropping an AML escalation.
    this.logger.warn(`Scorechain TMS alert received but not yet handled: ${JSON.stringify(alert)}`);
    // TODO(spec §12 Q6/Q7): correlate `alert.identifier` to the originating tx and raise the
    // AML manual-review signal (AmlError → CheckStatus.PENDING).
  }
}
