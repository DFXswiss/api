import { Injectable, NotFoundException } from '@nestjs/common';
import { WalletAppDto, WalletAppId } from '../dto/wallet-app.dto';
import { WALLET_APPS } from '../config/wallet-apps.config';

@Injectable()
export class WalletAppService {
  getAll(): WalletAppDto[] {
    return WALLET_APPS.filter((w) => !w.disabled);
  }

  getRecommended(): WalletAppDto[] {
    return WALLET_APPS.filter((w) => w.recommended && !w.disabled);
  }

  getById(walletId: WalletAppId): WalletAppDto {
    const wallet = WALLET_APPS.find((w) => w.id === walletId);
    if (!wallet) throw new NotFoundException('Wallet app not found');
    return wallet;
  }

  getBySupportedMethod(method: string): WalletAppDto[] {
    return WALLET_APPS.filter((w) => !w.disabled && w.supportedMethods.includes(method));
  }
}
