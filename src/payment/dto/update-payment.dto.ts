import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsOptional,  IsBoolean, IsString  } from "class-validator";
import { PaymentStatus } from "../payment.entity";

export class UpdatePaymentDto {

    @ApiProperty()
    @IsInt()
    id: number;

    @IsOptional()
    @IsString()
    info: string;

    @ApiProperty()
    @IsOptional()
    status: PaymentStatus;

}