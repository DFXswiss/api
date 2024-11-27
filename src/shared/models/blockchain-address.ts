import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Column } from 'typeorm';

export class BlockchainAddress {
  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  blockchain?: Blockchain;

  //*** FACTORY METHODS ***//

  static create(address: string, blockchain: Blockchain): BlockchainAddress {
    const newAddress = new BlockchainAddress();

    newAddress.address = address;
    newAddress.blockchain = blockchain;

    return newAddress;
  }

  //*** PUBLIC API ***//

  isEqual(comparedAddress: BlockchainAddress): boolean {
    return this.address === comparedAddress.address && this.blockchain === comparedAddress.blockchain;
  }
}
