import { POSClient, setProofApi, use } from '@maticnetwork/maticjs';
import { Web3ClientPlugin } from '@maticnetwork/maticjs-ethers';
import { BigNumber, Contract, ethers } from 'ethers';
import { Config, GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from '../shared/enums/blockchain.enum';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import { EvmUtil } from '../shared/evm/evm.util';
import { L2BridgeEvmClient } from '../shared/evm/interfaces';

export class PolygonClient extends EvmClient implements L2BridgeEvmClient {
  private readonly logger = new DfxLogger(PolygonClient);

  private l1Provider: ethers.providers.JsonRpcProvider;
  private l1Wallet: ethers.Wallet;
  private posClient: POSClient;

  private l2TxIdCache: Set<string>;

  constructor(params: EvmClientParams) {
    super(params);

    use(Web3ClientPlugin);
    setProofApi('https://proof-generator.polygon.technology/');

    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethWalletAddress } = GetConfig().blockchain.ethereum;
    const ethereumGateway = `${ethGatewayUrl}/${ethApiKey ?? ''}`;
    this.l1Provider = new ethers.providers.JsonRpcProvider(ethereumGateway);
    this.l1Wallet = new ethers.Wallet(ethWalletPrivateKey, this.l1Provider);

    const { polygonWalletAddress } = GetConfig().blockchain.polygon;

    this.posClient = new POSClient();
    void this.initPolygonNetwork(ethWalletAddress, polygonWalletAddress);

    this.l2TxIdCache = new Set();

    const address = '0xd1f92a7f86cc94639ed6f3acd2ed540c742602dc';
    const signature =
      '0xbaf12e1ad188c3ba134e084a105994022ee091c8f69c824985f18488d5e4f12c221b4dbbc7716ace59533e38e4d6fc10a9482159538cb4d203524b4c0fecda711b';

    const contract = '0x666a22Cca1d155032eD2F6ae7797616ede16F21c';
    const asset = {
      type: AssetType.TOKEN,
      chainId: '0x02567e4b14b25549331fcee2b56c647a8bab16fd',
      blockchain: Blockchain.POLYGON,
    } as Asset;
    const amount = 0.0001;
    const permittedAmount = 0.099;
    const nonce = 17;
    const deadline = BigNumber.from('115792089237316195423570985008687907853269984665640564039457584007913129639935');

    void this.permitTransfer(address, signature, contract, asset, amount, permittedAmount, nonce, deadline).then(
      console.log,
    );
  }

  async depositCoinOnDex(_amount: number): Promise<string> {
    throw new Error(`Method not implemented.`);
  }

  async withdrawCoinOnDex(_amount: number): Promise<string> {
    throw new Error(`Method not implemented.`);
  }

  async approveBridge(l1Token: Asset, _l2Token: Asset): Promise<string> {
    const l1Erc20Token = this.posClient.erc20(l1Token.chainId, true);

    const approveResult = await l1Erc20Token.approveMax();

    return approveResult.getTransactionHash();
  }

  async depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/deposit Polygon tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    // Increase the gas limit by a factor of 5 to enable the smart contract to be executed without "out of gas" error
    const gasLimit = (await this.getTokenGasLimitForAsset(l1Token)).mul(5);

    const l1Erc20Token = this.posClient.erc20(l1Token.chainId, true);

    const depositResult = await l1Erc20Token.deposit(
      EvmUtil.toWeiAmount(amount, l1Decimals).toString(),
      this.wallet.address,
      {
        gasLimit: gasLimit.toString(),
      },
    );

    return depositResult.getTransactionHash();
  }

  async withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string> {
    const l1Contract = this.getERC20ContractForDexL1(l1Token.chainId);
    const l2Contract = this.getERC20ContractForDex(l2Token.chainId);

    const l1Decimals = await l1Contract.decimals();
    const l2Decimals = await l2Contract.decimals();

    if (l1Decimals !== l2Decimals) {
      throw new Error(
        `Cannot bridge/withdraw Polygon tokens with different decimals. L1 Token: ${l1Token.uniqueName} has ${l1Decimals}, L2 Token: ${l2Token.uniqueName} has ${l2Decimals}`,
      );
    }

    const l2Erc20Token = this.posClient.erc20(l2Token.chainId);

    const withdrawStartResult = await l2Erc20Token.withdrawStart(EvmUtil.toWeiAmount(amount, l2Decimals).toString());
    const withdrawStartTxHash = await withdrawStartResult.getTransactionHash();
    this.logger.info(`Polygon withdrawStartTxHash: ${withdrawStartTxHash}`);

    return withdrawStartTxHash;
  }

  async checkL2BridgeCompletion(l1TxId: string): Promise<boolean> {
    try {
      return await Util.timeout(this.posClient.isDeposited(l1TxId), 20000);
    } catch {
      return false;
    }
  }

  async checkL1BridgeCompletion(l2TxId: string, l1Asset: Asset): Promise<boolean> {
    try {
      const isCheckPointed = await Util.timeout(this.posClient.isCheckPointed(l2TxId), 20000);
      if (!isCheckPointed) return false;

      const l1Erc20Token = this.posClient.erc20(l1Asset.chainId, true);

      if (!this.l2TxIdCache.has(l2TxId)) {
        const withdrawExitResult = await l1Erc20Token.withdrawExitFaster(l2TxId);
        const withdrawExitTxHash = await withdrawExitResult.getTransactionHash();
        this.logger.info(`Polygon withdrawExitTxHash: ${withdrawExitTxHash}`);

        this.l2TxIdCache.add(l2TxId);
      }

      const isWithdrawExited = await Util.timeout(l1Erc20Token.isWithdrawExited(l2TxId), 20000);

      if (isWithdrawExited) this.l2TxIdCache.delete(l2TxId);

      return isWithdrawExited;
    } catch {
      return false;
    }
  }

  //*** HELPER METHODS ***//

  private async initPolygonNetwork(ethWalletAddress: string, polygonWalletAddress: string) {
    const network = Config.network === 'mainnet' ? 'mainnet' : 'testnet';
    const version = network === 'mainnet' ? 'v1' : 'mumbai';

    await this.posClient.init({
      network: network,
      version: version,
      parent: {
        provider: this.l1Wallet,
        defaultConfig: {
          from: ethWalletAddress,
        },
      },
      child: {
        provider: this.wallet,
        defaultConfig: {
          from: polygonWalletAddress,
        },
      },
    });
  }

  private getERC20ContractForDexL1(chainId: string): Contract {
    return new ethers.Contract(chainId, ERC20_ABI, this.l1Wallet);
  }
}
