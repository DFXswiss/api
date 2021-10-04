import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('')
export class AppController {
    @Get()
    @Redirect('api')
    @ApiExcludeEndpoint()
    async home(): Promise<any> {
      // nothing to do (redirect to Swagger UI)
    }
}
