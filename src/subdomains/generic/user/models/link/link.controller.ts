import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LinkAddress } from './link-address.entity';
import { LinkService } from './link.service';

@ApiTags('link')
@Controller('link')
export class LinkController {
  constructor(private readonly linkService: LinkService) {}

  @Get(':authentication')
  async getLinkAddress(@Param('authentication') authentication: string): Promise<LinkAddress> {
    return this.linkService.getLinkAddress(authentication);
  }

  @Post(':authentication')
  async executeLinkAddress(@Param('authentication') authentication: string): Promise<LinkAddress> {
    return this.linkService.executeLinkAddress(authentication);
  }
}
