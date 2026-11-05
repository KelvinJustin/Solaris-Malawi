// Decorators and helpers imported from NestJS core.
import {
  Body,        // Extracts and validates the request body (piped into a DTO).
  Controller, // Marks this class as a route controller.
  Delete,
  Get,         // HTTP GET method decorator.
  HttpCode,    // Overrides the default HTTP status code a route returns.
  HttpStatus,  // Enum of standard status codes (200, 201, 429...).
  Post,        // HTTP POST method decorator.
  Req,         // Injects the raw Express request object.
  Res,         // Injects the raw Express response object.
  UseGuards,   // Attaches guard classes that run BEFORE the route handler.
} from '@nestjs/common';
import type { Request, Response } from 'express'; // Express types for raw req/res.

// The service holding the actual authentication business logic.
import { AuthService } from './auth.service.js';
// Current user decorator for extracting the user from the request.
import { CurrentUser } from './current-user.decorator.js';
// DTOs (Data Transfer Objects): define the shape + validation rules for
// each endpoint's request body. class-validator runs on these automatically.
import { RegisterAuthDto } from './dto/register-auth.dto.js';
import { LoginAuthDto } from './dto/login-auth.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { VerifyLoginDto } from './dto/verify-login.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
// Guards: JwtAuthGuard checks the JWT cookie; ArcjetGuard blocks bots/abuse.
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ArcjetGuard } from '../arcjet/arcjet.guard.js';

// Name of the cookie used to store the JWT. Defined once so "set" and
// "clear" can never drift apart and leave a stale cookie behind.
const COOKIE_NAME = 'access_token';

// Frontend route of the merchant home page, returned after a successful sign-in.
const MERCHANT_HOME = '/home';

// Shared settings for creating and clearing the authentication cookie.
const cookieOptions = {
  // httpOnly: true → the cookie is invisible to JavaScript (document.cookie).
  // This is the key defense against XSS token theft — an injected script
  // can't read it and exfiltrate it to an attacker's server.
  httpOnly: true,

  // secure: true only in production → cookie travels ONLY over HTTPS.
  // In dev (http://localhost) this must stay false or the browser
  // refuses to send the cookie back at all.
  secure: process.env.NODE_ENV === 'production',

  // sameSite: 'lax' → the cookie is sent on top-level navigations and
  // same-site requests, but NOT on cross-site POSTs. Blocks CSRF on state
  // changes (logouts, profile edits) without breaking normal links.
  // `as const` pins the literal type so TypeScript doesn't widen it to string.
  sameSite: 'lax' as const,

  // path: '/' → the cookie is valid for the ENTIRE site. Required so that
  // clearCookie() here can delete a cookie that may have been set from
  // any other route.
  path: '/',
};

// The cookie must live exactly as long as the JWT inside it ('1d' in
// AuthModule). Without maxAge it would be a session cookie that dies when the
// browser closes while the token is still valid. clearCookie() must NOT receive
// maxAge, so it gets cookieOptions and set() gets setCookieOptions.
const JWT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const setCookieOptions = { ...cookieOptions, maxAge: JWT_LIFETIME_MS };

// @Controller('auth') → every route in this class is prefixed with /auth,
// so @Post('login') becomes POST /auth/login.
@Controller('auth')

// ArcjetGuard runs FIRST for every route below: it checks the request
// against Arcjet's rules (shield, bot detection, rate limit) and throws
// 429/403 before the handler ever runs if anything looks malicious.
// Note: a @UseGuards on an INDIVIDUAL route below REPLACES this
// controller-level guard for that route (see getProfile).
@UseGuards(ArcjetGuard)
export class AuthController {
  // NestJS sees the AuthService type here, finds it in AuthModule's
  // providers/exports, and injects the singleton instance.
  constructor(private readonly authService: AuthService) { }

  // POST /auth/register — create a new merchant account.
  // @Body() pipes the JSON body through RegisterAuthDto's validation
  // (email format, password strength, etc.) BEFORE this method runs;
  // invalid payloads get a 400 automatically.
  @Post('register')
  register(@Body() dto: RegisterAuthDto) {
    // Delegate merchant registration logic to the authentication service.
    return this.authService.register(dto);
  }

  // POST /auth/login — step 1 of 2: validate email/password, then email
  // a one-time login code to the merchant. No token is issued here yet.
  @Post('login')
  login(@Body() dto: LoginAuthDto) {
    // Delegate initial login validation and OTP dispatch to the authentication service.
    return this.authService.login(dto);
  }

  // POST /auth/verify-login — step 2: check the emailed OTP. Only if the
  // code matches does AuthService set the access_token cookie.
  // This is a brute-force target — that's why ArcjetGuard's rate limit
  // (60/min/IP) protects it. Consider a stricter slidingWindow rule later.
  @Post('verify-login')
  async verifyLogin(
    @Body() dto: VerifyLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Verify the one-time login code and generate an access token.
    const result = await this.authService.verifyLogin(dto);
    // Attach the newly generated JWT access token as an HTTP-only cookie on the response.
    response.cookie(COOKIE_NAME, result.accessToken, setCookieOptions);
    // Return a success message confirming the login operation.
    // A JSON API cannot redirect the browser itself, so name the page the client must open next.
    return { message: 'Login successful', redirectTo: MERCHANT_HOME };
  }

  // POST /auth/verify-email — final step of REGISTRATION: verify ownership of
  // the email address with the emailed code. On success the merchant is signed
  // in straight away (access_token cookie), so the frontend can send them to
  // their home page.
  // Caveat: if this endpoint is reached via a GET link in an email,
  // corporate mail scanners pre-fetch links and may trip detectBot.
  // That flow should use Arcjet's email-validation instead of bot rules.
  @Post('verify-email')
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Verify the registration code, mark the email verified and mint a JWT.
    const result = await this.authService.verifyEmail(dto);
    // Start the session: the JWT travels only in the HTTP-only cookie.
    response.cookie(COOKIE_NAME, result.accessToken, setCookieOptions);
    // The token itself is never returned in the body.
    return { message: result.message, redirectTo: MERCHANT_HOME };
  }

  // POST /auth/resend-verification — send a fresh email-verification code.
  // Needed because register() cannot be called twice (409) and a code
  // expires after 10 minutes. Always answers with the same generic message.
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  // GET /auth/me — return the currently logged-in user's identity.
  //
  // IMPORTANT: this route-level @UseGuards REPLACES the controller-level
  // ArcjetGuard for this route. Right now /auth/me is only protected by
  // JwtAuthGuard. To protect it with BOTH, stack them:
  //   @UseGuards(ArcjetGuard, JwtAuthGuard)
  // (order matters: guards run left-to-right, so Arcjet cheaply rejects
  // abusive traffic before the more expensive JWT verification runs).
  @Get('me')
  @UseGuards(ArcjetGuard, JwtAuthGuard)
  getProfile(
    // The intersection type Request & { user: ... } reflects what the JWT
    // strategy does: it decodes the token and ATTACHES the payload to
    // request.user during the guard phase, so by the time this handler
    // runs, request.user is guaranteed to exist (the guard already 401'd
    // otherwise).
    @Req()
    request: Request & {
      user: {
        userId: string;
        email: string;
      };
    },
  ) {
    // Return only the identity. request.user also carries jti/exp (needed by
    // logout to revoke this exact token) but those are not for the client.
    return { userId: request.user.userId, email: request.user.email };
  }

  // POST /auth/logout
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req()
    request: Request & {
      user: {
        userId: string;
        email: string;
        jti: string;
        exp: number;
      };
    },
    @Res({ passthrough: true }) response: Response,
  ) {
    // Revoke this specific JWT in the database first.
    await this.authService.logout({
      userId: request.user.userId,
      jti: request.user.jti,
      exp: request.user.exp,
    });

    // Clear the browser cookie after revocation succeeds.
    response.clearCookie(COOKIE_NAME, cookieOptions);

    // Return a success payload confirming the logout operation.
    return { message: 'Logged out successfully' };
  }


  // DELETE /auth/account
  // Soft-deletes the authenticated merchant's account.
  // The JWT is still valid until it expires — the strategy's
  // deletedAt check blocks any further use immediately.
  @UseGuards(JwtAuthGuard)
  @Delete('account')
  deleteAccount(@CurrentUser() user: { userId: string }) {
    // Delegate the soft-deletion of the authenticated merchant account to the authentication service.
    return this.authService.deleteAccount(user.userId);
  }

}
