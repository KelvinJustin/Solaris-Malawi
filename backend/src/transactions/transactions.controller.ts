import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
  Param
} from '@nestjs/common';

import { TransactionsService } from './transactions.service.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
  ) { }

  /**
   * Creates a payment transaction for the currently authenticated merchant.
   *
   * The session identity is authoritative; the request body carries only the
   * payment details. The idempotency key prevents accidental duplicate
   * submissions when a client retries the exact same request.
   */
  @Post()
  create(
    @CurrentUser('userId') merchantId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(
      merchantId,
      idempotencyKey,
      createTransactionDto,
    );
  }

  /**
   * Retrieves a transaction by its public reference for the authenticated
   * merchant.
   */
  @Get(':reference')
  findOne(
    @CurrentUser('userId') merchantId: string,
    @Param('reference') reference: string,
  ) {
    return this.transactionsService.findOne(merchantId, reference);
  }
}