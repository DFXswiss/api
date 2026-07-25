import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ReceiveIbanStatus } from './receive-iban.enum';

// No @Transform(Util.sanitize) here: it would run before @IsString and throw on a non-string body, which the
// exception filter turns into a 500 on this unauthenticated endpoint. HTML sanitizing is pointless for an IBAN
// anyway - the service normalizes and structurally validates it.
export class CheckReceiveIbanDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;
}

export class ReceiveIbanDto {
  @ApiProperty({ enum: ReceiveIbanStatus })
  status: ReceiveIbanStatus;
}
