# ZC-04B-LIVE-01 one-time Mac transport probe

Fixed recipient: Issue #30, private lab only. Run the script manually with --once after exact-SHA verification and independent review. It uses existing gh authorization, which may have broader scopes; the code constrains its own POST to one Issue comment only. Never retry if a claim or POST is uncertain. No real Agent liveness, credential provisioning, deployment, scheduler, or polling. The Mac event explicitly declares agent_health_verified=false. Offline tests inject a fake GitHub client and never post.

Codex hardening: the CLI pins --hostname github.com and explicitly allowlists every API route; all raw HOME path components are validated before canonicalization (the only symlink aliases allowed are root-owned macOS /var and /tmp), and offline fake tests reject any POST outside Issue #30.
