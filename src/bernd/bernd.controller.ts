import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { LnurlpPaymentData } from 'src/integration/lightning/data/lnurlp-payment.data';
import { LnurlpLinkDto } from 'src/integration/lightning/dto/lnurlp-link.dto';
import { BerndService } from './bernd.service';
import { BerndWalletBalanceDto } from './dto/bernd-balance.dto';
import { BerndVerifySignatureDto } from './dto/bernd-verify-signature.dto';

// ----------------------------------------------------------------------------
class BalanceDto {
  @ApiProperty()
  balance: number;
}

class BalanceDtoMapper {
  static entityToDto(balance: number): BalanceDto {
    const dto: BalanceDto = {
      balance: balance,
    };

    return Object.assign(new BalanceDto(), dto);
  }
}

// ----------------------------------------------------------------------------
@ApiTags('Asset')
@Controller('bernd')
export class BerndController {
  // private readonly payInService: PayInService
  // private readonly payOutService: PayoutService,
  // private readonly dexService: DexService,

  constructor(private readonly berndService: BerndService) {}

  @Get('payInEntries')
  async checkPayInEntries(): Promise<void> {
    //await this.payInService.testMe();
    //await this.payOutService.testMe();
    //await this.dexService.testMe();
    return this.berndService.checkPayInEntries();
  }

  @Get('lnbits/balance')
  @ApiOkResponse({ type: BalanceDto })
  async getBalance(): Promise<BalanceDto> {
    return this.berndService.getBalance().then(BalanceDtoMapper.entityToDto);
  }

  @Get('lnbits/balance2')
  @ApiOkResponse({ type: BerndWalletBalanceDto })
  async getBalance2(): Promise<BerndWalletBalanceDto> {
    return this.berndService.getXBalance();
  }

  @Get('lnbits/lnUrlPLink')
  async getLnurlpLink(): Promise<LnurlpLinkDto[]> {
    return this.berndService.getLnurlpLinks();
  }

  @Post('lnbits/lnUrlPLink/:description')
  async addLnurlpLink(@Param('description') description: string): Promise<LnurlpLinkDto> {
    return this.berndService.addLnurlpLink(description);
  }

  @Delete('lnbits/lnUrlPLink/:id')
  async removeLnurlpLink(@Param('id') id: string): Promise<boolean> {
    return this.berndService.removeLnurlpLink(id);
  }

  @Get('lnbits/payment')
  async getPayment(): Promise<LnurlpPaymentData[]> {
    return this.berndService.getLnurlpPayments(null);
  }

  @Post('lnd/verifySignature')
  async verifySignature(@Body() verify: BerndVerifySignatureDto): Promise<boolean> {
    return this.berndService.verifySignature(verify);
  }
}
