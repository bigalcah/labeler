## 1. Login Flow Implementation

- [x] 1.1 Update `views/login.ejs` so the authentication/CSRF alert is rendered above the form while the form's existing control grid remains horizontally aligned.
- [x] 1.2 Update `routes/login/index.js` so a successful authentication redirects to `/queue` while preserving the existing session-cookie creation and CSRF-cookie cleanup.

## 2. Regression Coverage

- [x] 2.1 Extend `test/login-logout-http.test.js` to verify invalid authentication renders the alert before the form and keeps the expected form controls present.
- [x] 2.2 Extend the authenticated login HTTP coverage to verify the response redirects to `/queue` and sets a session cookie.
- [x] 2.3 Add or extend authenticated queue coverage to verify the redirected participant reaches the first pending card, or the completion view when no cards remain, with the participant identity and logout control visible.

## 3. Verification

- [x] 3.1 Run the focused login and study HTTP tests plus `npm run lint:js` and confirm all results pass.
- [x] 3.2 Perform manual browser verification at wide and narrow viewports for invalid-login layout, authenticated navigation, participant identity, and logout without modifying production data.

## 4. Failing-First Regression Tests

- [x] 4.1 Extend `test/login-logout-http.test.js` with failing-first assertions that anonymous `GET /login` emits no shared header, SEART navigation, `/queue`, `/progress`, or `/logout`, while retaining the login form and footer.
- [x] 4.2 Extend `test/home-login.browser.test.js` with a failing-first `/login` browser probe that verifies a single centered card, no horizontal overflow, and equal rendered widths for the username input-group, password input, and Start! button at 375, 768, and 1280 pixels.
- [x] 4.3 Add failing-first regression assertions for preserved alerts, CSRF field and rejection behavior, labels, autocomplete attributes, valid session creation, and the complete login-cookie-redirect-`/queue` flow.

## 5. EJS Implementation

- [x] 5.1 Update `views/login.ejs` to render the anonymous public login without the shared header or private navigation while retaining the alerts, CSRF field, labels, autocomplete attributes, form action, footer, and existing authentication-facing markup.
- [x] 5.2 Use only existing Bootstrap card, container, flex, grid, and width utilities in `views/login.ejs` to center the card in the available main area and keep Start! the same rendered width as both password and username controls at all three required viewport widths, without adding CSS or dependencies.

## 6. Local QA

- [x] 6.1 Run the focused login HTTP and browser regressions after implementation, then run `npm run lint:js` and the repository quality checks relevant to the changed files.
- [x] 6.2 Use the local application in a real browser at 375, 768, and 1280 pixels to verify the anonymous shell, centered card, equal control widths, alert placement, footer, CSRF rejection, and successful redirect to `/queue`.

## 7. Release Verification

- [ ] 7.1 Prepare the approved release through the existing validation and release workflow only after the failing-first tests pass, confirming that no CSS or dependency changes are included.

## 8. Production Verification

- [ ] 8.1 Request the deployed public `/login` without a session and record evidence at 375, 768, and 1280 pixels that the shared header, SEART navigation, `/queue`, `/progress`, and `/logout` are absent while the centered card and footer are present.
- [ ] 8.2 Exercise one approved participant login in production and verify the existing session semantics, redirect to `/queue`, private participant identity and logout control, then verify logout returns to the public login without changing study data.
