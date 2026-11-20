import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { getRawArcjetClient } from './arcjet.module.js';

@Injectable()
export class ArcjetGuard implements CanActivate {
  private readonly logger = new Logger(ArcjetGuard.name);

  /**
   * Runs request-level abuse checks before a route is allowed to continue.
   *
   * This is intentionally a staged gate: rate-limit and bot detection failures
   * are rejected at the edge before any business logic runs.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract the HTTP request object from the NestJS execution context
    const request = context.switchToHttp().getRequest();

    // Log the route template, not the raw URL, which may contain checkout tokens.
    const route = request.route?.path ?? '<unmatched-route>';
    this.logger.debug(
      `Arcjet checking: ${request.method} ${route} from ${request.ip}`,
    );


    const decision = await getRawArcjetClient().protect(request);

    // Identify the evaluation result
    this.logger.debug(
      `Arcjet decision: ${decision.conclusion} | ID: ${decision.id}`,
    );

    // Identify whether the decision involved cloud evaluation
    if (decision.id.startsWith('req_')) {
      this.logger.debug('Arcjet evaluation: Cloud API');
    } else if (decision.id.startsWith('lreq_')) {
      this.logger.debug('Arcjet evaluation: Local');
    }

    // Handle evaluation errors
    if (decision.isErrored()) {
      this.logger.error(
        `Arcjet evaluation error: ${JSON.stringify(
          decision.reason,
          null,
          2,
        )}`,
      );
    }


    // Handle requests that have been explicitly denied
    if (decision.isDenied()) {
      // Check if the denial was caused by hitting a rate limit
      if (decision.reason.isRateLimit()) {
        this.logger.warn(
          `Rate limit hit: ${request.method} ${route} from ${request.ip}`,
        );
        throw new HttpException(
          'Too many requests, please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Check if the denial was triggered by a detected bot
      if (decision.reason.isBot()) {
        this.logger.warn(
          `Bot detected: ${request.method} ${route} from ${request.ip}`,
        );
        throw new HttpException('Bot detected.', HttpStatus.FORBIDDEN);
      }

      // Handle any other block reasons
      this.logger.warn(
        `Request blocked: ${request.method} ${route} from ${request.ip} — reason: ${JSON.stringify(decision.reason)}`,
      );
      throw new HttpException('Request blocked.', HttpStatus.FORBIDDEN);
    }

    // Log successful requests that passed all checks
    this.logger.log(
      `Arcjet allowed: ${request.method} ${route} from ${request.ip}`,
    );

    // Allow the request to proceed to the route handler
    return true;
  }
}