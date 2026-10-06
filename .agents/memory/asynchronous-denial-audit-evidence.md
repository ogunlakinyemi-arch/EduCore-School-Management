---
name: Asynchronous denial audit evidence
description: Avoid attributing delayed security audit writes to the next test or preservation window.
---

Drain outstanding denial audit writes before resetting disposable test fixtures; match audit evidence to the request's real actor and event rather than selecting the first security record after a reset.

**Why:** A denied request's audit insert can finish after its HTTP response. A later test reset did not prevent that insert from appearing in the next test, causing a false actor-attribution failure.

**How to apply:** Track and await pending audit promises in isolated routed tests before cleanup. In live verification, bound audit evidence by actor, action, path and time; do not equate an HTTP response completing with all appended audit evidence being settled.
