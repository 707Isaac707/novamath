# Nova Math Botasaurus Sports Scraper

This is the production scraper feeding the Nova Math Sports tab.

Botasaurus runs in a scheduled GitHub Action every 5 minutes, not inside the
Vercel Hobby deployment. It fetches the configured public/authorized sports
sources, extracts direct HLS streams, validates them, signs the complete fresh
snapshot, and POSTs it to the existing Nova Math Sports API.

The Vercel route atomically replaces the prior Upstash snapshot. The Sports tab
reloads the current snapshot every 30 seconds. No additional Vercel function is
added, so Nova Math stays at 11 API functions.

The scraper does not bypass DRM, authentication, paywalls, or protected media
traffic.

## Defaults

When no custom source variable is supplied, the scraper refreshes the two
public sources Nova Math previously loaded directly:

- IPTV-org Sports
- the configured IPTV Cat list

The browser no longer needs to trust old entries: Botasaurus re-fetches and
validates the stream manifests before each snapshot is published.

## Required shared secret

Create the same secret in both places:

- Vercel project env: BOTASAURUS_INGEST_SECRET
- GitHub repository Actions secret: BOTASAURUS_INGEST_SECRET

The payload uses HMAC-SHA256 over:
<unix_timestamp>.<raw_json_body>

Vercel rejects bad signatures and timestamps outside a five-minute window.

## Optional repository variable

BOTASAURUS_SPORTS_SOURCE_URLS

Comma- or newline-separated source URLs. Optional labels use Label|URL.

Only use sources you are allowed to scrape and redistribute.
