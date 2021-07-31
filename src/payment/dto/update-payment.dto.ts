import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsOptional,  IsBoolean  } from "class-validator";
import { PaymentStatus } from "../payment.entity";

export class UpdatePaymentDto {

    @ApiProperty()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsOptional()
    status: PaymentStatus

}