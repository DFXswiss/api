import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { IknaBlockchain } from '../services/ikna.service';

export class IknaAddressQuery {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(IknaBlockchain)
  blockchain: IknaBlockchain;
}

export class IknaBfsAddressQuery extends IknaAddressQuery {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  depth: string;
}
