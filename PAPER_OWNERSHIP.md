Paper ownership and Railway upgrade

The desk CLI starts one PaperService and PaperStore. /paper is static HTML;
GET /api/paper calls the existing service's view(). Requests never open stores.

writer.lock now stays on disk, but its existence does not establish ownership.
fs-ext holds an exclusive, nonblocking flock on its inode until store close or
process death. Never delete or replace this file while a writer is active.
Concurrent writers must use the same account directory on a filesystem supporting
shared flock semantics. Separate unshared volumes cannot protect one shared account.

First upgrade from PID-only locks:
1. Stop the old Railway deployment completely, including overlapping deployments
   and diagnostic scripts that open this account.
2. Keep the existing persisted account directory and state.json.
3. Set PAPER_LEGACY_OWNER_STOPPED=true for the first upgraded startup.
4. After successful migration, remove that variable. Later restarts recover
   automatically, including SIGKILL; no PID liveness inference is used.

Without this explicit assertion, legacy PID-only ownership fails closed because
a PID from another container cannot prove whether the previous writer is alive.
Do not run older PID-lock releases concurrently with the upgraded application.

The native fs-ext module requires Python and a C/C++ build toolchain during npm ci.
Railway's build must support native Node addons. Runtime requires flock support.
SIGINT/SIGTERM await discovery, position quote jobs and serialized persistence,
then close the ownership file descriptor. SCALP configuration is unchanged.
