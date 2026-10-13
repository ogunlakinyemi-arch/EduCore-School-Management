---
name: Orphaned workflow ports
description: Why a failed managed artifact restart can coexist with a working preview and occupied port
---

When a managed artifact workflow fails with an address-in-use error but its proxied preview still responds, inspect the actual listener and process ancestry before retrying. An older server may remain alive outside the newly failed workflow's process tree. Terminate only the confirmed stale local service processes, then restart the managed services sequentially.

**Why:** A restart can report a failed new process while the previous service keeps its port and continues answering proxied requests. Repeated restarts do not free that listener and obscure which code is serving.

**How to apply:** Use this when artifact workflow logs report port conflicts despite a healthy proxy response. Do not replace the artifact-owned workflow or alter its managed port configuration to work around an orphaned process.

For preservation-sensitive recovery, a port conflict alone does not authorize
termination. Prove the exact listener's artifact ownership and process identity,
check that no active HTTP/provider/database connection or open transaction is
being interrupted, confirm the Development worker pause, and inspect startup
for migrations, scheduled sends or other mutations before restarting. Recheck
identity and quiescence immediately before signaling only the verified orphan.
If those checks cannot establish safety, leave the listener alone and report
the recovery blocker rather than force killing or broadly matching processes.

**Why:** An older listener can still serve valid user traffic or provider work.
Replacing it without quiescence and startup checks could interrupt transactions
or trigger external delivery even when its managed replacement reports failed.