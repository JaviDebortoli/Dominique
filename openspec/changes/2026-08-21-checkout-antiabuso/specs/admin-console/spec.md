# Delta for admin-console

**Type**: Delta — modifies the existing `admin-console` capability's "Authenticated Access" requirement. Adds an edge rate limit on repeated `POST /admin/login` attempts, explicitly with no persistent lockout.

## MODIFIED Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes, including standalone `/api/admin/*` route handlers that sit outside the console route-group's middleware matcher and therefore MUST verify the session independently.

`POST /admin/login` MUST be rate-limited at the edge (Nginx), mirroring the `mp_webhook`/`checkout` `limit_req_zone` pattern, to throttle repeated login attempts. This throttle MUST be edge-only and self-resetting; the system MUST NOT implement any persistent account lockout state. The owner MUST always be able to attempt login again with her correct credentials once the edge rate-limit window resets, regardless of how many prior attempts failed.

(Previously: covered unauthenticated blocking only, across page routes and the API route handlers named above. This adds an edge rate limit on repeated `/admin/login` POSTs, explicitly with no persistent lockout.)

#### Scenario: Unauthenticated access blocked

- GIVEN a user is not logged in
- WHEN they request an admin route
- THEN the system MUST redirect to login and MUST NOT expose admin data or actions

#### Scenario: Unauthenticated request to an admin API route

- GIVEN a user has no valid session
- WHEN they call `POST /api/admin/categories` directly
- THEN the system MUST respond `401 Unauthorized` as JSON and MUST NOT create a category

#### Scenario: Unauthenticated rename or delete

- GIVEN a user has no valid session
- WHEN they call `PATCH` or `DELETE` on `/api/admin/categories/[id]`
- THEN the system MUST respond `401 Unauthorized` as JSON, not a redirect
- AND MUST NOT rename or delete the category

#### Scenario: Unauthenticated product or variant mutation

- GIVEN a user has no valid session
- WHEN they call `PATCH` or `DELETE` on `/api/admin/products/[id]` or its variants sub-route
- THEN the system MUST respond `401 Unauthorized` as JSON, not a redirect
- AND MUST NOT mutate the product or variant

#### Scenario: Repeated login attempts throttled at the edge

- GIVEN a client sends `POST /admin/login` requests faster than the configured rate
- WHEN the excess requests arrive
- THEN Nginx MUST reject them before they reach the application

#### Scenario: Owner is never permanently locked out

- GIVEN the owner (or an attacker) has made many failed `POST /admin/login` attempts
- WHEN the edge rate-limit window resets
- THEN the owner MUST be able to attempt login again with her correct credentials, since no persistent lockout state exists for her account
