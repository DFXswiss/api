import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SimplePriceRequest {
  @ApiProperty({
    description: 'Comma-separated list of CoinGecko coin ids (max 100)',
    example: 'bitcoin,ethereum',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({
    description: 'Comma-separated list of target currencies',
    example: 'usd,eur',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  vs_currencies: string[];
}
