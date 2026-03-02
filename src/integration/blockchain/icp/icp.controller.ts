import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../shared/dto/blockchain-token-balance.dto';
import { Blockchain } from '../shared/enums/blockchain.enum';
import { InternetComputerService } from './services/icp.service';

@ApiTags('Internet Computer')
@Controller('icp')
export class InternetComputerController {
  constructor(private readonly internetComputerService: InternetComputerService) {}

  @Get('address')
  getWalletAddress(): string {
    return this.internetComputerService.getWalletAddress();
  }

  @Get('balance')
  async getBalance(): Promise<number> {
    return this.internetComputerService.getNativeCoinBalance();
  }

  @Get('balance/tokens')
  async getTokenBalances(): Promise<BlockchainTokenBalance[]> {
    const assets = [
      this.createToken('ckBTC', 'mxzaz-hqaaa-aaaar-qaada-cai', 8),
      this.createToken('ckETH', 'ss2fx-dyaaa-aaaar-qacoq-cai', 18),
      this.createToken('ckUSDC', 'xevnm-gaaaa-aaaar-qafnq-cai', 6),
      this.createToken('ckUSDT', 'cngnf-vqaaa-aaaar-qag4q-cai', 6),
    ];
    return this.internetComputerService.getDefaultClient().getTokenBalances(assets);
  }

  @Get('tx/:blockIndex/complete')
  async isTxComplete(@Param('blockIndex') blockIndex: string): Promise<boolean> {
    return this.internetComputerService.getDefaultClient().isTxComplete(blockIndex);
  }

  private createToken(name: string, canisterId: string, decimals: number): Asset {
    const asset = new Asset();
    asset.chainId = canisterId;
    asset.blockchain = Blockchain.INTERNET_COMPUTER;
    asset.type = AssetType.TOKEN;
    asset.decimals = decimals;
    asset.name = name;
    asset.uniqueName = `${name}/${Blockchain.INTERNET_COMPUTER}`;

    return asset;
  }
}
