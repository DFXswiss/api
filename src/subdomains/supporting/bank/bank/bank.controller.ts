import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { BankService } from './bank.service';
import { BankDto } from './dto/bank.dto';
import { BankMapper } from './dto/bank.mapper';
import { CheckReceiveIbanDto, ReceiveIbanDto } from './dto/receive-iban.dto';

@ApiTags('Bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllBanks(): Promise<BankDto[]> {
    const banks = await this.bankService.getAllBanks();

    return banks.map(BankMapper.toDto);
  }

  // PUT because the IBAN to check belongs in the body, never in the URL - this is a read, it changes nothing.
  @Put('receiveIban')
  @ApiBearerAuth()
  // RateLimitGuard first; the route-level @Throttle below is what sets the limit. Deliberately more generous
  // than the 10/60 on the one-shot endpoints (kyc 2fa/verify, auth mail login): RateLimitGuard buckets IPv4
  // callers by /24, so everyone behind one company NAT shares this counter, and an IBAN field is re-checked
  // several times while a customer corrects a typo.
  @UseGuards(RateLimitGuard, OptionalJwtAuthGuard)
  @Throttle(60, 60)
  @ApiOkResponse({ type: ReceiveIbanDto })
  async checkReceiveIban(
    @GetJwt() jwt: JwtPayload | undefined,
    @Body() dto: CheckReceiveIbanDto,
  ): Promise<ReceiveIbanDto> {
    return { status: await this.bankService.getReceiveIbanStatus(dto.iban, jwt?.account) };
  }
}
