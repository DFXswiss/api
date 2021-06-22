import { Controller, Get } from '@nestjs/common';

@Controller('')
export class AppController {

  @Get('/info')
  async getAppinfo(): Promise<any> {
    return '1111';
  }
}
