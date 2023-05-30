import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnUrlForwardService } from './lnurl-forward.service';
import { LnurlPayRequestDto } from './dto/lnurlp-payrequest.dto';

@ApiTags('LNURLp')
@Controller('lnurlp')
export class LnUrlForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlPForward(@Param('id') id: string): Promise<LnurlPayRequestDto> {
    return this.forwardService.lnurlpForward(id);
  }

  @Get('cb/:id/:amount')
  async lnUrlPCallbackForward(@Param('id') id: string, @Param('amount') amount: number): Promise<any> {
    return this.forwardService.lnurlpCallbackForward(id, amount);
  }
}
