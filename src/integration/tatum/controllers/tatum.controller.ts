import {
  BadRequestException,
  Controller,
  Headers,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { TatumWebhookPayloadMapper } from '../dto/tatum-webhook-payload.mapper';
import { TatumWebhookService } from '../services/tatum-webhook.service';

@ApiTags('Tatum')
@Controller('tatum')
export class TatumController {
  private readonly logger = new DfxLogger(TatumController);

  constructor(private readonly tatumWebhookService: TatumWebhookService) {}

  @Post('addressWebhook')
  @ApiExcludeEndpoint()
  async addressWebhook(
    @Headers('x-payload-hash') tatumSignature,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      if (!this.tatumWebhookService.isValidWebhookSignature(tatumSignature, req.body)) {
        this.logger.warn(`Received Tatum webhook with invalid signature '${tatumSignature}': ${req.body}`);
        throw new BadRequestException('Invalid signature');
      }

      const dto = TatumWebhookPayloadMapper.payloadToWebhookDto(JSON.parse(req.body));
      this.tatumWebhookService.processAddressWebhook(dto);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;

      this.logger.error('addressWebhook failed:', e);
      throw new InternalServerErrorException('addressWebhook failed');
    }

    res.status(HttpStatus.OK);
  }
}
