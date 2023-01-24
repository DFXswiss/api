import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { LinkAddressDtoMapper } from './dto/link-address-dto.mapper';
import { LinkAddressDto } from './dto/link-address.dto';
import { LinkService } from './link.service';

@ApiTags('Link')
@Controller('link')
@ApiExcludeController()
export class LinkController {
  constructor(private readonly linkService: LinkService) {}

  @Get(':authentication')
  @ApiOkResponse({ type: LinkAddressDto })
  async getLinkAddress(@Param('authentication') authentication: string): Promise<LinkAddressDto> {
    return this.linkService.getLinkAddress(authentication).then(LinkAddressDtoMapper.entityToDto);
  }

  @Post(':authentication')
  @ApiCreatedResponse({ type: LinkAddressDto })
  async executeLinkAddress(@Param('authentication') authentication: string): Promise<LinkAddressDto> {
    return this.linkService.executeLinkAddress(authentication).then(LinkAddressDtoMapper.entityToDto);
  }
}
