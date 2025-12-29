import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnurlwInvoiceDto, LnurlWithdrawRequestDto } from 'src/integration/lightning/dto/lnurlw.dto';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurld')
export class LnurldForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnurldForward(@Param('id') id: string, @Query() params: any): Promise<LnurlWithdrawRequestDto> {
    return this.forwardService.lnurldForward(id, params);
  }

  @Get('cb/:id/:var')
  async lnurldCallbackForward(
    @Param('id') id: string,
    @Param('var') variable: string,
    @Query() params: any,
  ): Promise<LnurlwInvoiceDto> {
    return this.forwardService.lnurldCallbackForward(id, variable, params);
  }
}
