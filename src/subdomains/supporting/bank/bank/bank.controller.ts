import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
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
  @Put('receive-iban')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: ReceiveIbanDto })
  async checkReceiveIban(
    @GetJwt() jwt: JwtPayload | undefined,
    @Body() dto: CheckReceiveIbanDto,
  ): Promise<ReceiveIbanDto> {
    return { status: await this.bankService.getReceiveIbanStatus(dto.iban, jwt?.account) };
  }
}
