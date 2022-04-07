import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MonitoringService } from './monitoring.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private monitoringService: MonitoringService) {}
}
