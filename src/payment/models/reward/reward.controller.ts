import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('reward')
@Controller('reward')
export class RouteController {
  constructor() {}
}
