---
name: Optional offline caching and push activation
description: Published proxy privacy headers must not make service-worker activation depend on cache warming.
---
Keep offline-cache warming and cleanup optional for push worker installation.
Continue refusing private/no-store/authenticated responses; never relax caching
security to make push ready.

**Why:** On 2026-10-23 the published site served its offline page and checked
icon with `Cache-Control: private`. Required cache warming rejected those
responses and prevented the worker from activating, despite valid JavaScript
and reachable assets.

**How to apply:** Diagnose served status/type/cache headers as well as script
existence. Observe the actual registration's worker state with bounded waits;
registration success alone is not activation or push delivery. Do not infer
that a source correction is deployed when restarting/publication is forbidden.
