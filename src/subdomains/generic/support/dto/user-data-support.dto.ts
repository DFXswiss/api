import { IsNotEmpty } from 'class-validator';

export class UserDataSupportInfo {
  userDataId: number;
}

export class UserDataSupportQuery {
  @IsNotEmpty()
  key: string;
}
