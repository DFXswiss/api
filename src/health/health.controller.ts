import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('/')
export class HealthController {
  @Get()
  @Redirect('api')
  @ApiExcludeEndpoint()
  async check(): Promise<any> {
    // nothing to do
  }
}
