import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { IdentService } from './ident.service';
import { IdentResultDto } from './dto/ident-result.dto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@ApiTags('Ident')
@Controller('ident')
export class IdentController {
  private readonly logger = new DfxLogger(IdentController);

  constructor(private readonly identService: IdentService) {}

  @Post('online')
  @ApiExcludeEndpoint()
  async onlineIdWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);
    await this.identService.identUpdate(data);
  }

  @Post('video')
  @ApiExcludeEndpoint()
  async videoIdWebhook(@RealIP() ip: string, @Body() data: IdentResultDto) {
    this.checkWebhookIp(ip, data);
    await this.identService.identUpdate(data);
  }

  private checkWebhookIp(ip: string, data: IdentResultDto) {
    if (!Config.kyc.allowedWebhookIps.includes('*') && !Config.kyc.allowedWebhookIps.includes(ip)) {
      this.logger.error(`Received webhook call from invalid IP ${ip}: ${JSON.stringify(data)}`);
      throw new ForbiddenException('Invalid source IP');
    }
  }
}
