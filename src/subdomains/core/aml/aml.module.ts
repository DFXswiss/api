import { forwardRef, Module } from '@nestjs/common';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { AmlService } from './aml.service';

@Module({
  imports: [forwardRef(() => UserModule), BankModule],
  controllers: [],
  providers: [AmlService],
  exports: [AmlService],
})
export class AmlModule {}
