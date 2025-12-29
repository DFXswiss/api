import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnurlWithdrawRequestDto } from '../../../../integration/lightning/dto/lnurlw.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurlw')
export class LnUrlWForwardController {
  constructor(private forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlWForward(@Param('id') id: string): Promise<LnurlWithdrawRequestDto> {
    return this.forwardService.lnurlwForward(id);
  }

  @Get('cb/:id')
  async lnUrlWCallbackForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurlwCallbackForward(id, params);
  }
}
