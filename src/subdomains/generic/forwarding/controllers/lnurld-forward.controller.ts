import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnUrlForwardService } from '../services/lnurl-forward.service';

@ApiTags('LNURL')
@Controller('lnurld')
export class LnurldForwardController {
  constructor(private readonly forwardService: LnUrlForwardService) {}

  @Get(':id')
  async lnUrlDForward(@Param('id') id: string, @Query() params: any): Promise<any> {
    return this.forwardService.lnurldForward(id, params);
  }
}
