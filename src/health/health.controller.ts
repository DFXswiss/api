import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('/')
export class HealthController {
  @Get()
  async check(): Promise<any> {
    return Promise.resolve('<h1>OK</h1>');
  }
}
