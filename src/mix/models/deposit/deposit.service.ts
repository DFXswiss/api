import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BlockchainService } from 'src/integration/blockchain/blockchain.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DepositRepository } from 'src/mix/models/deposit/deposit.repository';
import { Util } from 'src/shared/utils/util';
import { Deposit } from './deposit.entity';
import { RandomDepositDto } from './dto/random-deposit.dto';

@Injectable()
export class DepositService {
  constructor(private blockchainService: BlockchainService, private depositRepo: DepositRepository) {}

  async getDeposit(id: number): Promise<Deposit> {
    return this.depositRepo.findOne(id);
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

  async createRandomDeposit({ blockchain }: RandomDepositDto): Promise<void> {
    const { ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN } = Blockchain;

    if (![ARBITRUM, OPTIMISM, ETHEREUM, BINANCE_SMART_CHAIN].includes(blockchain)) {
      throw new BadRequestException(
        'Creating random address is supported only for ARBITRUM, OPTIMISM, ETHEREUM and BINANCE_SMART_CHAIN.',
      );
    }

    const { address, privateKey } = this.blockchainService.getRandomEvmWallet(blockchain);
    console.log('address:', address, 'privateKey:', privateKey);
    const deposit = Deposit.create(address, Util.encrypt(privateKey, Config.blockchain.evm.encryptionKey), blockchain);
    console.log('deposit:', deposit);

    await this.depositRepo.save(deposit);
  }
}
