import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnurlPayRequestDto } from '../dto/lnurlp.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURLp')
@Controller('lnurlp')
export class LnUrlForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlPForward(@Param('id') id: string): Promise<LnurlPayRequestDto> {
    return this.forwardService.lnurlpForward(id);
  }

  @Get('cb/:id')
  async lnUrlPCallbackForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlpCallbackForward(id, params);
  }
}
