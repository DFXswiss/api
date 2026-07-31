import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { CLIENT_HEADER } from 'src/shared/utils/request-client';
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
  // RateLimitGuard buckets by /24 (IPv4) or /64 (IPv6), so customers sharing a NAT share this
  // budget and can crowd each other out. Accepted: an error report is diagnostic, not a customer
  // action, and the alternative — no per-client limit at all — is worse. The service holds a
  // second, process-wide budget, because a per-client limit alone does not bound a distributed
  // flood of the ERROR stream.
  @UseGuards(RateLimitGuard)
  @Throttle(20, 60)
  @HttpCode(HttpStatus.NO_CONTENT)
  logError(
    @Body() dto: CreateClientErrorDto,
    @Headers(CLIENT_HEADER) client?: string,
    @Headers('user-agent') userAgent?: string,
  ): void {
    this.clientErrorService.logError(dto, client, userAgent);
  }
}
