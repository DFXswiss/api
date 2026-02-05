import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function check() {
  try {
    const app = await NestFactory.create(AppModule, { logger: ['error'] });
    await app.close();
    console.log('✓ Startup check passed');
    process.exit(0);
  } catch (e) {
    console.error('✗ Startup check failed:', e.message);
    process.exit(1);
  }
}

void check();
