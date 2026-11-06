import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// wrapper so you can write @UseGuards(JwtAuthGuard)
// instead of the longer @UseGuards(AuthGuard('jwt')) everywhere.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}