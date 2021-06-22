import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm';
import config from './config/config';
import { TypeOrmConfig } from './config/typeorm.config';
import { AppController } from './app.controller';
import { UserController } from './user/user.controller';
import { UserService } from './user/user.service';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [config],
    }),
  ],
  controllers: [AppController, UserController],
  providers: [UserService],
  exports: [UserService]
})

export class AppModule {}
