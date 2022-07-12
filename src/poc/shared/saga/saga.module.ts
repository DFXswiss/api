import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PocSagaLogRepository } from './repositories/saga-log.repository';
import { PocSagaRepository } from './repositories/saga.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PocSagaLogRepository, PocSagaRepository])],
  controllers: [],
  providers: [],
  exports: [TypeOrmModule],
})
export class SagaModule {}
