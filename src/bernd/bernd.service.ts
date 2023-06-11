import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { LnurlpPaymentData } from 'src/integration/lightning/data/lnurlp-payment.data';
import { LnurlpLinkDto } from 'src/integration/lightning/dto/lnurlp-link.dto';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { LightningStrategy } from 'src/subdomains/supporting/payin/strategies/register/impl/lightning.strategy';
import { BerndWalletBalanceDto } from './dto/bernd-balance.dto';
import { BerndVerifySignatureDto } from './dto/bernd-verify-signature.dto';

@Injectable()
export class BerndService {
  constructor(private lightningStrategy: LightningStrategy, private lightningService: LightningService) {}

  async checkPayInEntries() {
    await this.lightningStrategy.checkPayInEntries();
  }

  async getBalance(): Promise<number> {
    return this.lightningService.getDefaultClient().getLnBitsBalance();
  }

  async getLnurlpLinks(): Promise<LnurlpLinkDto[]> {
    return this.lightningService.getDefaultClient().getLnurlpLinks();
  }

  async addLnurlpLink(description: string): Promise<LnurlpLinkDto> {
    return this.lightningService.getDefaultClient().addLnurlpLink(description);
  }

  async removeLnurlpLink(id: string): Promise<boolean> {
    return this.lightningService.getDefaultClient().removeLnurlpLink(id);
  }

  async getLnurlpPayments(id: string): Promise<LnurlpPaymentData[]> {
    return this.lightningService.getDefaultClient().getLnurlpPayments(id);
  }

  async verifySignature(verify: BerndVerifySignatureDto): Promise<boolean> {
    const message = Config.auth.signMessageGeneral + verify.address;
    return this.lightningService.verifySignature(message, verify.signature, verify.publicKey);
  }

  async getXBalance(): Promise<BerndWalletBalanceDto> {
    const lightningClient = this.lightningService.getDefaultClient();

    const confirmedWalletBalance = await lightningClient.getLndConfirmedWalletBalance();
    const localChannelBalance = await lightningClient.getLndLocalChannelBalance();
    const remoteChannelBalance = await lightningClient.getLndRemoteChannelBalance();
    const lnbitsBalance = await lightningClient.getLnBitsBalance();

    return {
      lnd: {
        confirmedWalletBalance: confirmedWalletBalance,
        localChannelBalance: localChannelBalance,
        remoteChannelBalance: remoteChannelBalance,
      },
      lnbits: { balance: lnbitsBalance },
    };
  }
}
