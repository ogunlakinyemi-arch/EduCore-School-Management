---
name: Orphaned workflow ports
description: Why a failed managed artifact restart can coexist with a working preview and occupied port
---

When a managed artifact workflow fails with an address-in-use error but its proxied preview still responds, inspect the actual listener and process ancestry before retrying. An older server may remain alive outside the newly failed workflow's process tree. Terminate only the confirmed stale local service processes, then restart the managed services sequentially.

**Why:** A restart can report a failed new process while the previous service keeps its port and continues answering proxied requests. Repeated restarts do not free that listener and obscure which code is serving.

**How to apply:** Use this when artifact workflow logs report port conflicts despite a healthy proxy response. Do not replace the artifact-owned workflow or alter its managed port configuration to work around an orphaned process.