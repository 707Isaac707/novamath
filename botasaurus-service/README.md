# Nova Math Botasaurus Sports Scraper

This service is the automatic sports-stream scraper for Nova Math.

It runs separately from the main Vercel deployment and pushes a complete,
signed stream snapshot into the existing Nova Math `/api/sports-api` route.
The main site remains at 11 Vercel API functions.

## Flow

1. Botasaurus scrapes the configured public/authorized sports source pages.
2. It extracts direct HLS (`.m3u8`) URLs exposed by those pages.
3. It validates the HLS manifests.
4. It HMAC-signs the JSON payload.
5. It POSTs the complete snapshot to Nova Math.
6. The Vercel Sports API atomically overwrites the current Upstash snapshot.
7. The Sports tab reads only the newest non-expired Botasaurus snapshot once
   Botasaurus ingest is enabled.

Old snapshots are never merged with new ones. If a snapshot expires, the
Vercel API deletes it and returns no Botasaurus channels until a fresh push
arrives.

This implementation does not inspect protected browser network traffic,
bypass DRM, defeat paywalls/login, or extract private media manifests.

## Botasaurus service environment variables

### Required

`BOTASAURUS_INGEST_SECRET`

The shared signing secret. Use the exact same value in this service and in the
Nova Math Vercel project.

`BOTASAURUS_ALLOWED_HOSTS`

Comma-separated allow-list of hosts the scraper may visit.

Example:

```text
example.org,streams.example.org
```

`BOTASAURUS_SPORTS_SOURCE_URLS`

Comma- or newline-separated source pages. A source can optionally have a label:

```text
Example Sports|https://example.org/live
https://streams.example.org/sports
```

### Recommended

`NOVA_SPORTS_INGEST_URL`

Default:

```text
https://novamath-three.vercel.app/api/sports-api?action=botasaurus-ingest
```

`BOTASAURUS_INTERVAL_SECONDS`

Default: `300`

`BOTASAURUS_SNAPSHOT_TTL_SECONDS`

Default: `900`

`BOTASAURUS_VALIDATE_STREAMS`

Default: `1`

`BOTASAURUS_MAX_STREAMS`

Default: `300`

### Optional manual-run endpoint

`BOTASAURUS_ADMIN_SECRET`

When set, this enables:

```text
POST /run-now
X-Admin-Secret: <BOTASAURUS_ADMIN_SECRET>
```

## Vercel environment variable

Add this to the existing Nova Math Vercel project:

`BOTASAURUS_INGEST_SECRET`

Do not add a new Vercel function. The receiver is implemented inside the
existing `api/sports-api.mjs` -> `server/functions/sports-api.cjs` route.

## Docker

```bash
docker build -t nova-botasaurus .
docker run --rm -p 8000:8000 \
  -e BOTASAURUS_INGEST_SECRET="replace-with-a-long-random-secret" \
  -e BOTASAURUS_ALLOWED_HOSTS="example.org" \
  -e BOTASAURUS_SPORTS_SOURCE_URLS="https://example.org/live" \
  nova-botasaurus
```

Health endpoint:

```text
GET /health
```

The scheduler runs immediately after startup and then repeats at the configured
interval.
