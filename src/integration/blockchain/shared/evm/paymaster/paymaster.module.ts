import { Module, forwardRef } from '@nestjs/common';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { PaymasterController } from './paymaster.controller';
import { PaymasterService } from './paymaster.service';

@Module({
  imports: [forwardRef(() => AddressPoolModule)],
  controllers: [PaymasterController],
  providers: [PaymasterService],
  exports: [PaymasterService],
})
export class PaymasterModule {}
