import { Module, forwardRef } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { UserModule } from 'src/subdomains/generic/user/user.module';
import { FeeController } from './fee.controller';
import { FeeRepository } from './fee.repository';
import { FeeService } from './fee.service';

@Module({
  imports: [SharedModule, forwardRef(() => UserModule)],
  controllers: [FeeController],
  providers: [FeeService, FeeRepository],
  exports: [FeeService],
})
export class FeeModule {}
