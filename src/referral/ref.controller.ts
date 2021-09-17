import { Controller, Get, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
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
  @UsePipes(ValidationPipe)
  async createRef(@RealIP() ip: string, @Query('code') ref, @Res() res: Response): Promise<void> {
    if (ip && ref) {
      await this.refService.addOrUpdate(ip, ref);
      res.redirect('https://dfx.swiss', 307);
    } else {
      const ref = await this.refService.get(ip);
      res.status(200).send({ ref });
    }
  }
}
