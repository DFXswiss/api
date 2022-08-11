import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { LinkDto } from './dto/link.dto';
import { LinkService } from './link.service';

@ApiTags('link')
@Controller('link')
export class LinkController {
  constructor(private readonly linkService: LinkService) {}

  @Post()
  async linkAddressToUser(@Body() data: LinkDto, @RealIP() ip: string): Promise<void> {
    return this.linkService.linkAddressToUser(data, ip);
  }
}
