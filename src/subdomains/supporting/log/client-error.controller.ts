import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { ClientErrorService } from './client-error.service';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

@ApiTags('log')
@Controller('log/clientError')
export class ClientErrorController {
  constructor(private readonly clientErrorService: ClientErrorService) {}

  @Post()
  @ApiOperation({
    summary: 'Report a frontend error',
    description:
      'Records a client-side error as an ERROR log line so it becomes visible in log monitoring. ' +
      'Unauthenticated on purpose: the errors worth catching happen before or without a session.',
  })
  @UseGuards(RateLimitGuard)
  @Throttle(20, 60)
  @HttpCode(HttpStatus.NO_CONTENT)
  logError(
    @Body() dto: CreateClientErrorDto,
    @Headers('x-client') client?: string,
    @Headers('user-agent') userAgent?: string,
  ): void {
    this.clientErrorService.logError(dto, client, userAgent);
  }
}
