import { WalletDto } from '../dto/wallet.dto';
import { Wallet } from '../wallet.entity';

export class WalletDtoMapper {
  static mapWalletDto(wallet: Wallet): WalletDto {
    return {
      amlRules: wallet.amlRules,
      address: wallet.address,
      name: wallet.name,
      displayName: wallet.displayName,
      isKycClient: wallet.isKycClient,
      customKyc: wallet.customKyc,
      identMethod: wallet.identMethod,
      apiUrl: wallet.apiUrl,
      apiKey: wallet.apiKey,
      webhookConfig: wallet.webhookConfig,
    };
  }
}
