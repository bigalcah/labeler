## Purpose

Define a safe, repeatable contract for the shared CI runtime and its complete validation gate, so a green result proves that all required checks ran against the intended revision.

## ADDED Requirements

### Requirement: CI credential input stays structured and private
The shared validation workflow MUST provide the expected CI account usernames through its study configuration and deliver the matching passwords as one JSON array on standard input to the credential generator. Password values MUST NOT appear in command arguments, workflow logs, or saved evidence.

#### Scenario: Generate the temporary CI account manifest
- **WHEN** the runtime setup generates credentials for the configured CI participants
- **THEN** the generator receives a JSON array with one password per configured username through standard input and writes the manifest without exposing password values

#### Scenario: Reject incomplete or unsafe credential input
- **WHEN** the credential input is missing, malformed, has the wrong number of entries, or the generator fails
- **THEN** setup fails with sanitized output and no credential value is printed or persisted in workflow logs

### Requirement: CI runtime hostnames agree with local TLS identity
The shared validation runtime MUST use `localhost` consistently for the local base URL, public hostname, application origin, and Caddy site identity when those values identify the same local service.

#### Scenario: Reach the local service over TLS
- **WHEN** integration or E2E checks connect to the local service using its configured origin
- **THEN** the requested hostname agrees with the hostname in the local Caddy TLS certificate and the request reaches the intended service

### Requirement: Mounted runtime files are accessible only to their consumers
The workflow MUST assign explicit ownership and read access to generated secret-related files for their intended container consumers, and MUST make the mounted Caddy configuration readable by Caddy. Permission changes MUST be limited to the runtime files that require them and MUST NOT make credential values available in logs or command arguments.

#### Scenario: Runtime containers read their mounted files
- **WHEN** the ephemeral containers start with generated account and session files mounted
- **THEN** each intended consumer can read its required file and unrelated services do not receive those mounts

#### Scenario: Caddy reads its runtime configuration
- **WHEN** Caddy starts with the mounted CI Caddyfile
- **THEN** its runtime identity can read the configuration without granting write access to the running service

### Requirement: CI category seed is scoped to its study
The shared validation workflow MUST create its temporary category with the owning study identifier and participant identifier required by the study schema. Any identifier captured from the database command MUST contain only the intended returned value, not notices or formatted output.

#### Scenario: Seed a private category for the integration participant
- **WHEN** the integration setup creates a category for its participant
- **THEN** the inserted row is scoped to the current study and participant, and the captured category identifier is a single unformatted value

### Requirement: Session cookie uses the server's mounted key
The workflow MUST create and sign the integration session cookie inside the `labeling-server` container using the session key mounted at `/run/secrets/session-current`. The host MUST NOT need to export the key contents to create the cookie.

#### Scenario: Authenticate the integration browser session
- **WHEN** E2E setup creates the session cookie for the test participant
- **THEN** the cookie is signed with the same mounted key the server reads and can be used by the server for the test session

### Requirement: Partial CI setup has fail-safe cleanup
The shared validation workflow MUST run its cleanup step after setup or validation failure. Cleanup MUST invoke Compose only when the runtime Compose environment file exists, MUST remove the temporary runtime directory when present, and MUST preserve the original validation failure rather than reporting an incomplete cleanup as success.

#### Scenario: Cleanup after setup stops before Compose configuration
- **WHEN** setup fails before writing the Compose environment file
- **THEN** cleanup does not invoke Compose with a missing environment file, removes available temporary runtime files, and the workflow remains failed

#### Scenario: Cleanup after Compose runtime was created
- **WHEN** Compose setup began and a later validation gate fails
- **THEN** cleanup stops the ephemeral services, removes temporary runtime files, and the workflow reports the validation failure

### Requirement: A green validation result proves every required gate ran
The shared validation workflow MUST execute and pass lint, unit tests, OpenSpec validation, Compose configuration, Dockerfile validation, integration, and E2E gates for the same pull request revision. A failed or unobserved required gate MUST fail the workflow. The workflow MUST NOT use skip conditions, `continue-on-error`, or another bypass to turn a failed or omitted required gate into success.

#### Scenario: All required gates pass on the pull request revision
- **WHEN** the shared workflow validates a pull request
- **THEN** lint, unit, OpenSpec, Compose, Dockerfile, integration, and E2E gates all execute against that revision and the check succeeds only if each passes

#### Scenario: A required gate fails or is omitted
- **WHEN** any required gate fails, is skipped, or does not run for the validated revision
- **THEN** the shared validation check fails and cannot be reported as a complete successful gate

#### Scenario: A stale run reports success after the branch changes
- **WHEN** a successful run is associated with a revision different from the current pull request head
- **THEN** that run is not treated as evidence that the current head passed validation

#### Scenario: Report verification evidence accurately
- **WHEN** validation evidence is recorded or reviewed
- **THEN** it identifies the validated revision and shows the conclusion and execution status of every required gate without inferring success from a summary message alone
