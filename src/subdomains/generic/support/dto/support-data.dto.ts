import { IsNotEmpty } from 'class-validator';

export class SupportReturnData {
  userDataId: number;
}

export class SupportDataQuery {
  @IsNotEmpty()
  key: string;
}
