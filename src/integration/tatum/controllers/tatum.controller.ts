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
import { TatumWebhookDto } from '../dto/tatum.dto';
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
    const dto = JSON.parse(req.body) as TatumWebhookDto;

    if (!this.tatumWebhookService.isValidWebhookSignature(tatumSignature, req.body)) {
      this.logger.warn(`Received Tatum webhook with invalid signature '${tatumSignature}': ${JSON.stringify(dto)}`);
      throw new BadRequestException('Invalid signature');
    }

    try {
      this.tatumWebhookService.processAddressWebhook(dto);
    } catch (e) {
      this.logger.error('processAddressWebhook failed:', e);
      throw new InternalServerErrorException('processAddressWebhook failed');
    }

    res.status(HttpStatus.OK);
  }
}
