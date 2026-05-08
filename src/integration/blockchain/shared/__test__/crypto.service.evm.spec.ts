import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import { RailgunService } from 'src/integration/railgun/railgun.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { ArkadeService } from '../../arkade/arkade.service';
import { ArweaveService } from '../../arweave/services/arweave.service';
import { BitcoinService } from '../../bitcoin/services/bitcoin.service';
import { CardanoService } from '../../cardano/services/cardano.service';
import { FiroService } from '../../firo/services/firo.service';
import { InternetComputerService } from '../../icp/services/icp.service';
import { LightningService } from '../../../lightning/services/lightning.service';
import { MoneroService } from '../../monero/services/monero.service';
import { SolanaService } from '../../solana/services/solana.service';
import { SparkService } from '../../spark/spark.service';
import { TronService } from '../../tron/services/tron.service';
import { ZanoService } from '../../zano/services/zano.service';
import { BlockchainRegistryService } from '../services/blockchain-registry.service';
import { CryptoService } from '../services/crypto.service';

describe('CryptoService.verifyEthereumBased', () => {
  const ERC6492_SUFFIX = '6492649264926492649264926492649264926492649264926492649264926492';
  const MESSAGE = 'sign-in challenge';

  let service: CryptoService;
  let evmClient: { isContract: jest.Mock; verifyErc6492Signature: jest.Mock };
  let blockchainRegistry: BlockchainRegistryService;

  beforeEach(async () => {
    evmClient = {
      isContract: jest.fn(),
      verifyErc6492Signature: jest.fn(),
    };

    blockchainRegistry = createMock<BlockchainRegistryService>();
    (blockchainRegistry.getEvmClient as jest.Mock).mockReturnValue(evmClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        TestUtil.provideConfig({}),
        { provide: BitcoinService, useValue: createMock<BitcoinService>() },
        { provide: LightningService, useValue: createMock<LightningService>() },
        { provide: SparkService, useValue: createMock<SparkService>() },
        { provide: ArkadeService, useValue: createMock<ArkadeService>() },
        { provide: FiroService, useValue: createMock<FiroService>() },
        { provide: MoneroService, useValue: createMock<MoneroService>() },
        { provide: ZanoService, useValue: createMock<ZanoService>() },
        { provide: SolanaService, useValue: createMock<SolanaService>() },
        { provide: TronService, useValue: createMock<TronService>() },
        { provide: CardanoService, useValue: createMock<CardanoService>() },
        { provide: InternetComputerService, useValue: createMock<InternetComputerService>() },
        { provide: ArweaveService, useValue: createMock<ArweaveService>() },
        { provide: RailgunService, useValue: createMock<RailgunService>() },
        { provide: BlockchainRegistryService, useValue: blockchainRegistry },
      ],
    }).compile();

    service = module.get(CryptoService);
  });

  it('returns true for a valid EOA ECDSA signature without hitting the smart-account path', async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(MESSAGE);

    await expect(service.verifySignature(MESSAGE, wallet.address, signature)).resolves.toBe(true);

    expect(evmClient.isContract).not.toHaveBeenCalled();
    expect(evmClient.verifyErc6492Signature).not.toHaveBeenCalled();
  });

  it('routes 6492-suffixed signatures straight to the universal validator (no isContract gate)', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const sigWith6492 = '0x' + 'aa'.repeat(200) + ERC6492_SUFFIX;
    evmClient.verifyErc6492Signature.mockResolvedValue(true);

    await expect(service.verifySignature(MESSAGE, address, sigWith6492)).resolves.toBe(true);

    expect(evmClient.isContract).not.toHaveBeenCalled();
    expect(evmClient.verifyErc6492Signature).toHaveBeenCalledTimes(1);
    expect(evmClient.verifyErc6492Signature).toHaveBeenCalledWith(MESSAGE, address, sigWith6492);
  });

  it('routes signatures on deployed contract addresses to the universal validator', async () => {
    const address = '0x2222222222222222222222222222222222222222';
    const sig = '0x' + 'bb'.repeat(65);
    evmClient.isContract.mockResolvedValue(true);
    evmClient.verifyErc6492Signature.mockResolvedValue(true);

    await expect(service.verifySignature(MESSAGE, address, sig)).resolves.toBe(true);

    expect(evmClient.isContract).toHaveBeenCalledWith(address);
    expect(evmClient.verifyErc6492Signature).toHaveBeenCalledWith(MESSAGE, address, sig);
  });

  it('returns false for garbage signatures on EOA addresses without invoking the validator', async () => {
    const address = '0x3333333333333333333333333333333333333333';
    const garbage = '0x' + 'cc'.repeat(65);
    evmClient.isContract.mockResolvedValue(false);

    await expect(service.verifySignature(MESSAGE, address, garbage)).resolves.toBe(false);

    expect(evmClient.isContract).toHaveBeenCalledTimes(1);
    expect(evmClient.verifyErc6492Signature).not.toHaveBeenCalled();
  });

  it('returns false when the universal validator rejects a 6492-wrapped signature', async () => {
    const address = '0x4444444444444444444444444444444444444444';
    const sig = '0x' + 'dd'.repeat(200) + ERC6492_SUFFIX;
    evmClient.verifyErc6492Signature.mockResolvedValue(false);

    await expect(service.verifySignature(MESSAGE, address, sig)).resolves.toBe(false);

    expect(evmClient.verifyErc6492Signature).toHaveBeenCalledTimes(1);
  });

  it('returns false (does not throw) when the registry or RPC throws', async () => {
    const address = '0x5555555555555555555555555555555555555555';
    const sig = '0x' + 'ee'.repeat(65);
    (blockchainRegistry.getEvmClient as jest.Mock).mockImplementation(() => {
      throw new Error('chain not configured');
    });

    await expect(service.verifySignature(MESSAGE, address, sig)).resolves.toBe(false);
  });

  it('normalises a missing 0x prefix before forwarding to the universal validator', async () => {
    const address = '0x6666666666666666666666666666666666666666';
    const noPrefixSig = 'aa'.repeat(200) + ERC6492_SUFFIX;
    evmClient.verifyErc6492Signature.mockResolvedValue(true);

    await expect(service.verifySignature(MESSAGE, address, noPrefixSig)).resolves.toBe(true);

    expect(evmClient.verifyErc6492Signature).toHaveBeenCalledWith(MESSAGE, address, '0x' + noPrefixSig);
  });
});
