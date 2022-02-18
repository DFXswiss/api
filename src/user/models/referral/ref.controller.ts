import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { RefService } from './ref.service';

@ApiTags('ref')
@Controller('ref')
export class RefController {
  constructor(private readonly refService: RefService) {}

  @Get()
  @ApiExcludeEndpoint()
  async createRef(@RealIP() ip: string, @Query('code') ref: string, @Res() res: Response): Promise<void> {
    if (ip && ref) {
      // redirect to app controller
      res.redirect(307, `/app?code=${ref}`);
    } else {
      ref = await this.refService.get(ip);
      res.status(200).send({ ref });
    }
  }
}
