# CardV2 Isolated Capture Report

- Run: `aa83fc94-b1cb-4416-9010-900470a96dc8`
- Study: `pr-card-sorting-isolated-v2`
- Database: `labeling_isolated_v2`
- Sample source: `plans/merged_after_rework_cards_seed_20260510.csv`
- Cards: 300
- GitHub snapshots: 300
- Telemetry events: 5320
- HTTP 403 responses: 0
- HTTP 429 responses: 0
- Omitted GitHub records: 11, retained as explicit `UNAVAILABLE`/CSV fallback records
- Raw payloads or credentials: not included

## Runtime QA

- `GET /actuator/health`: `{"status":"UP"}`
- `POST /login` for `javier`: redirected to `/javier/queue`
- Queue rendered `Evidence: GitHub snapshot` and the CardV2 evidence sections.
- HTML contained no other participant names, raw payload markers, or credentials.
- A private category was created and one card was classified offline; the request redirected to the next card and the classification remained associated with `javier`.

The deterministic coverage verifier remains non-compatible because the 11 omitted records prevent required endpoint coverage certification. No existing promoted study was modified.
