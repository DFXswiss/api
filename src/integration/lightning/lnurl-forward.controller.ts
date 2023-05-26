import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnUrlForwardService } from './lnurl-forward.service';
import { LnUrlPayRequestDto } from './dto/lnurlp-payrequest.dto';

@ApiTags('LnUrlP')
@Controller('lnurlp')
export class LnUrlForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlPForward(@Param('id') id: string): Promise<LnUrlPayRequestDto> {
    return this.forwardService.lnUrlPForward(id);
  }

  @Get('cb/:id/:amount')
  async lnUrlPCallbackForward(@Param('id') id: string, @Param('amount') amount: number): Promise<void> {
    return this.forwardService.lnUrlPCallbackForward(id, amount);
  }
}
