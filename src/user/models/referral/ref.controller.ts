import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RealIP } from 'nestjs-real-ip';

@ApiTags('ref')
@Controller('ref')
export class RefController {
  @Get()
  @ApiExcludeEndpoint()
  async createRef(@RealIP() ip: string, @Query('code') ref: string, @Res() res: Response): Promise<void> {
    if (ip && ref) {
      // redirect to app controller
      res.redirect(301, `/app?code=${ref}`);
    }
  }
}
