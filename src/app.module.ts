import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { StatisticController } from './statistic/statistic.controller';
import { StatisticService } from './statistic/statistic.service';
import { CfpService } from './statistic/cfp.service';
import { AinModule } from './ain/ain.module';
import { SharedModule } from './shared/shared.module';
import { PaymentModule } from './payment/payment.module';
import { UserModule } from './user/user.module';
import { AdminController } from './admin/admin.controller';
import { SeedService } from './shared/seed/seed.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mssql',
      host: process.env.SQL_HOST,
      port: Number.parseInt(process.env.SQL_PORT),
      username: process.env.SQL_USERNAME,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB,
      entities: ['dist/**/*.entity{.ts,.js}'],
      synchronize: process.env.SQL_SYNCHRONIZE === 'true',
      migrationsRun: process.env.SQL_MIGRATE === 'true',
      migrations: ['migration/*.js'],
      cli: {
        migrationsDir: 'migration',
      },
      connectionTimeout: 30000,
    }),
    SharedModule,
    AinModule,
    PaymentModule,
    UserModule,
  ],
  controllers: [AppController, StatisticController, AdminController],
  providers: [StatisticService, CfpService, SeedService],
  exports: [],
})
export class AppModule {}
