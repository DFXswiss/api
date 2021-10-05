import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Details, UserAgent } from 'express-useragent';
import { RealIP } from 'nestjs-real-ip';
import { RefService } from './ref.service';

@ApiTags('ref')
@Controller('ref')
export class RefController {
  constructor(private readonly refService: RefService) {}

  @Get()
  @ApiExcludeEndpoint()
  async createRef(@RealIP() ip: string, @Query('code') ref: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    if (ip && ref) {
      await this.refService.addOrUpdate(ip, ref);

      // redirect user depending on platform
      let url = 'https://dfx.swiss';
      const agent = this.getAgentDetails(req);
      if (agent.isAndroid) url = 'https://play.google.com/store/apps/details?id=com.defichain.app.dfx';
      if (agent.isiPhone) url = 'https://apps.apple.com/app/id1582633093';

      res.redirect(url, 307);
    } else {
      ref = await this.refService.get(ip);
      res.status(200).send({ ref });
    }
  }

  private getAgentDetails(req: Request): Details {
    return new UserAgent().parse(req.headers['user-agent']);
  }
}
