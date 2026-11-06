
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class VerifyLoginDto {
    // Identifies the merchant whose login challenge is being verified.
    @IsEmail()
    email!: string;

    // Require exactly six numeric digits for the one-time password.
    @IsString()
    @Length(6, 6)
    @Matches(/^\d{6}$/)
    code!: string;
}
