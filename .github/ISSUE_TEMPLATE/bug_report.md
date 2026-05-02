---
name: Bug report
about: Something demonstrably misbehaves
title: "bug: <one-line summary>"
labels: bug
assignees: ''
---

## What broke

<short prose>

## Reproduce

1. …
2. …
3. …

## Expected

<what should have happened>

## Actual

<what happened — paste exact error code, status, audit event>

## Environment

- Sigvault commit: `git rev-parse HEAD` → ...
- Platform: Linux/macOS/Windows + version
- Node: `node -v`
- How are you running it: bare metal / Docker / Kubernetes / Helm chart

## Audit log excerpt (if applicable)

```jsonl
<paste relevant lines from $DATA_DIR/audit.log — REDACT bearer tokens>
```

## What you've already ruled out

<helps reviewers skip dead ends>
