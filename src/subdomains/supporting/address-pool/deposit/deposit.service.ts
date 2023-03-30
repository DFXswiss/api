import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { DepositRepository } from 'src/subdomains/supporting/address-pool/deposit/deposit.repository';
import { Util } from 'src/shared/utils/util';
import { Deposit } from './deposit.entity';
import { RandomDepositDto } from './dto/random-deposit.dto';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';

@Injectable()
export class DepositService {
  constructor(private depositRepo: DepositRepository) {}

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOneBy({ id });
  }

  async getDepositByAddress({ address, blockchain }: BlockchainAddress): Promise<Deposit> {
    return this.depositRepo.findOneBy({ address, blockchain });
  }

  async getDepositKey(address: BlockchainAddress): Promise<string> {
    const deposit = await this.getDepositByAddress(address);

    if (!deposit) return null;

    return Util.decrypt(deposit.key, Config.blockchain.evm.encryptionKey);
  }

  async getAllDeposit(): Promise<Deposit[]> {
    return this.depositRepo.find();
  }

  async getNextDeposit(blockchain: Blockchain): Promise<Deposit> {
    // does not work with find options
    const deposit = await this.depositRepo
      .createQueryBuilder('deposit')
      .leftJoin('deposit.route', 'route')
      .where('route.id IS NULL AND deposit.blockchain = :blockchain', { blockchain })
      .getOne();
    if (!deposit) throw new InternalServerErrorException(`No unused deposit for ${blockchain} found`);

    return deposit;
  }

  async createRandomDeposits({ blockchain, count }: RandomDepositDto): Promise<void> {
    const { ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN } = Blockchain;

    if (![ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN].includes(blockchain)) {
      throw new BadRequestException(
        'Creating random address is supported only for ARBITRUM, OPTIMISM, ETHEREUM and BINANCE_SMART_CHAIN.',
      );
    }

    for (const _ of new Array(count)) {
      await this.createRandomDeposit(blockchain);
    }
  }

  //*** HELPER METHODS ***//

  private async createRandomDeposit(blockchain: Blockchain): Promise<void> {
    const { address, privateKey } = EvmUtil.getRandomWallet();
    const deposit = Deposit.create(address, blockchain, Util.encrypt(privateKey, Config.blockchain.evm.encryptionKey));

    await this.depositRepo.save(deposit);
  }
}
