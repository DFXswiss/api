import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { LightningClient } from './lightning-client';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class LightningService implements OnModuleInit {
  private readonly logger = new DfxLogger(LightningService);

  private readonly client: LightningClient;

  constructor(http: HttpService) {
    this.client = new LightningClient(http);
  }

  onModuleInit() {
    //void this.testGetBalance();
    //void this.testGetPayments();
    //void this.testGetLnUrlPLinks();
    //void this.testAddLnUrlPLink();
    //void this.testRemoveLnUrlPLink();
    //void this.testVerifySignature();
  }

  getDefaultClient(): LightningClient {
    return this.client;
  }

  async testGetBalance() {
    const balance = await this.client.getBalance();
    this.logger.info('Wallet Balance: ' + balance);
    this.logger.info('');
  }

  async testGetPayments() {
    // Example 1: f934dba08924ecff33300edff6323dae479b404044d3a6b014fe2f7e4bcca630
    // Example 2: 3b2fdf4de02f14531ea305ae76c56d79a552a63a3f77daf44f6ec47b3ce08c79
    const payments = await this.client.getLnUrlPPayments(
      'f934dba08924ecff33300edff6323dae479b404044d3a6b014fe2f7e4bcca630',
    );

    this.logger.info('Number of Payments: ' + payments.length);
    this.logger.info('');

    for (const payment of payments) {
      this.logger.info('Id:            ' + payment.paymentDto.checking_id);
      this.logger.info('Pending:       ' + payment.paymentDto.pending);
      this.logger.info('Amount:        ' + payment.paymentDto.amount);
      this.logger.info('Memo:          ' + payment.paymentDto.memo);
      this.logger.info('Time / Expiry: ' + payment.paymentDto.time + ' / ' + payment.paymentDto.expiry);
      this.logger.info('Bolt11:        ' + payment.paymentDto.bolt11);
      this.logger.info('');
    }
  }

  async testGetLnUrlPLinks() {
    const lnUrlPLinks = await this.client.getLnUrlPLinks();
    this.logger.info('Number of LNURLp Links: ' + lnUrlPLinks.length);
    this.logger.info('');

    for (const lnUrlPLink of lnUrlPLinks) {
      this.logger.info('Id:          ' + lnUrlPLink.id);
      this.logger.info('Description: ' + lnUrlPLink.description);
      this.logger.info('Min / Max:   ' + lnUrlPLink.min + ' / ' + lnUrlPLink.max);
      this.logger.info('LNURL:       ' + lnUrlPLink.lnurl);
      this.logger.info('');
    }
  }

  async testAddLnUrlPLink() {
    const addedLnUrlPLink = await this.client.addLnUrlPLink('Test 1');

    this.logger.info('Id:          ' + addedLnUrlPLink.id);
    this.logger.info('Description: ' + addedLnUrlPLink.description);
    this.logger.info('Min / Max:   ' + addedLnUrlPLink.min + ' / ' + addedLnUrlPLink.max);
    this.logger.info('LNURL:       ' + addedLnUrlPLink.lnurl);
    this.logger.info('');
  }

  async testRemoveLnUrlPLink() {
    const lnUrlPLinks = await this.client.getLnUrlPLinks();

    const foundLnUrlPLink = lnUrlPLinks.find((obj) => {
      return obj.description === 'Test 1';
    });

    if (foundLnUrlPLink) {
      const foundLnUrlPLinkId = foundLnUrlPLink.id;

      const success = await this.client.removeLnUrlPLink(foundLnUrlPLinkId);

      this.logger.info('Remove LNURLp success: ' + success);
      this.logger.info('');
    }
  }

  async testVerifySignature() {
    const message =
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM';
    const signature =
      'rdtc8yopn8esk9ot9spnbqa5urbdo1wiehkg579so17kdgft1zmd4uqaayhnsjtumeew8k6iya5d9in7jn1jku8xeiskikoyihnj3ox7';

    const isValid = await this.client.verifySignature(message, signature);

    this.logger.info('Is valid signature: ' + isValid);
    this.logger.info('');
  }
}
