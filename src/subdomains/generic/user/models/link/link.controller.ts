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
    return LinkAddressDtoMapper.entityToDto(await this.linkService.getLinkAddress(authentication));
  }

  @Post(':authentication')
  @ApiCreatedResponse({ type: LinkAddressDto })
  async executeLinkAddress(@Param('authentication') authentication: string): Promise<LinkAddressDto> {
    return LinkAddressDtoMapper.entityToDto(await this.linkService.executeLinkAddress(authentication));
  }
}
