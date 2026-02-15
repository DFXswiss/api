import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FiroService } from './services/firo.service';

@ApiTags('Firo')
@Controller('firo')
export class FiroController {
  constructor(private readonly firoService: FiroService) {}

  @Get('info')
  async getInfo(): Promise<{ blockHeight: number; headers: number; blocks: number; chain: string }> {
    const client = this.firoService.getDefaultClient();
    const info = await client.getInfo();

    return {
      blockHeight: await client.getBlockCount(),
      headers: info.headers,
      blocks: info.blocks,
      chain: info.chain,
    };
  }
}
