# ZC-06A metadata-only preflight
Run only after independent code review in a pinned detached Mac checkout:
`node bridge/zc06a-metadata.mjs --inspect`.
It does not invoke agy/gh, read auth or config files, send prompts, start daemons, or write any files. It checks only $HOME/.local/bin/agy metadata and returns a sanitized JSON summary.
No authenticated provider, model capability, subscription billing, allowed tools, or permission mode has been verified. All remain UNKNOWN even when an executable exists. Never authorize real model execution based on this report.
Official headless documentation: https://antigravity.google/docs/cli/headless/
