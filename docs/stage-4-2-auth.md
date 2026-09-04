# Stage 4.2 — authentication

Implements gate item 4.2: registration, one-time codes with expiry and
attempt limits, login, session issuance and account recovery.

## Model

Phone number is the primary identifier. A one-time code proves control of the
number at registration and at recovery; day-to-day sign-in uses a password.
This keeps the SMS bill proportional to signups rather than to logins, which
matters when a practitioner signs in several times a shift, and it means an
SMS gateway outage does not lock the whole platform out.

## Flow

1. `POST /api/v1/auth/register` — claims the number, creates a
   `PENDING_VERIFICATION` user, sends a code.
2. `POST /api/v1/auth/verify-phone` — consumes the code, sets
   `phone_verified_at`.
3. `POST /api/v1/auth/set-password` — sets the password, moves the account to
   `UNDER_REVIEW`, publishes `practitioner.registered`.
4. `POST /api/v1/auth/login` — password login, issues a session cookie.
5. `GET /api/v1/auth/session` — the caller's identity and permissions.
6. `POST /api/v1/auth/logout` — revokes the current session.
7. `POST /api/v1/auth/password/reset-request` and `reset-confirm` — recovery.
8. `POST /api/v1/auth/resend-code` — throttled resend.

Setting a password does not sign the user in. The account is `UNDER_REVIEW`
and cannot accept shifts until credentialling completes in Stage 5, so
issuing a session at that point would misrepresent the account's status.

## Policy

| Control | Value | Where |
| --- | --- | --- |
| Code length | 6 digits | `domain/otp.ts` |
| Code lifetime | 10 minutes | `OTP_TTL_SECONDS` |
| Code attempts | 5, then the code is dead | `OTP_MAX_ATTEMPTS` |
| Resend cooldown | 60 seconds | `OTP_RESEND_COOLDOWN_SECONDS` |
| Sends per hour | 5 per user per purpose | `OTP_MAX_SENDS_PER_HOUR` |
| Login failures | 5 consecutive within 15 minutes | `domain/lockout.ts` |
| Lockout | 15 minutes | `LOGIN_LOCKOUT_SECONDS` |
| Session lifetime | 14 days | `domain/session.ts` |
| Step-up freshness | 5 minutes | `STEP_UP_WINDOW_SECONDS` |
| Password floor | 10 characters | `lib/password.ts` |

## Decisions worth knowing

**Codes are stored as an HMAC, not a plain hash.** A six-digit code has a
million possibilities; an unkeyed SHA-256 of a leaked `otp_codes` table is
reversible by exhaustive search in under a second. The HMAC key is
`SESSION_SECRET`, so the stored digest is useless without the server secret.
The user id and purpose are bound into the digest, so a password-reset code
cannot be replayed as a step-up confirmation.

**Session tokens are stored as a plain SHA-256.** The opposite reasoning: the
input is 256 bits from the CSPRNG, so there is nothing to brute-force, and a
slow hash would add latency to every authenticated request.

**Sessions are server-side rows, not JWTs.** A JWT cannot be revoked before it
expires. When a compliance officer suspends an account after a clinical
incident, access has to stop immediately.

**Login always verifies a hash, even for an unknown number.** Otherwise the
response time distinguishes a registered number from an unregistered one, and
the endpoint becomes a directory of who works through Medilink. The same
reasoning drives the identical responses from `register` and
`reset-request`.

**Lockout state is derived from `identity.login_attempts`.** An in-memory
counter resets on deploy and is bypassed by spreading guesses across web
containers.

**Codes are sent after the transaction commits.** Holding a transaction open
across a call to an SMS gateway parks a database connection for the gateway's
latency, and a gateway timeout would roll back a code the practitioner has
already received.

## Not in this stage

- Step-up auth enforcement on sensitive actions — the session carries
  `step_up_at` and `isStepUpFresh` exists, but no route requires it yet
  (gate item 4.8).
- A real SMS gateway. `SMS_PROVIDER=console` prints the full message, code
  included, to the container log so local development can read it. It is
  rejected outside `APP_ENV=local`, so a misconfigured staging deploy fails
  loudly instead of quietly shipping every signup code to a log aggregator.
  The Termii and Africa's Talking adapters throw until 4.7, and when they land
  they must log the masked recipient only, never the body.
- Rate limiting by IP address, as opposed to by account. A single attacker
  spreading attempts across many accounts is not yet throttled.
- Device trust. The `identity.devices` table is unused until push
  notifications land.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose logs -f web        # the console SMS adapter prints codes here
```

Register, then read the code from the web container log:

```
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"phone":"08031234567","fullName":"Test Practitioner"}'
```
