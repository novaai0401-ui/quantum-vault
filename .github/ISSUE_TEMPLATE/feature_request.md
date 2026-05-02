---
name: Feature request
about: Suggest a new operator-facing capability
title: "feat: <one-line summary>"
labels: enhancement
assignees: ''
---

## The operator problem

<describe the situation a real Sigvault operator is in that the
current capability set does not solve. Concrete examples beat
abstractions.>

## The proposed shape

<one paragraph; not a design doc. What does the operator type / call /
configure?>

## Alternatives considered

- **Workaround today**: …
- **Adjacent product that does this**: …

## Constraints

- Must remain zero-dep in qv-server (or justify exception).
- Must not break wire format v3.0.
- Must default fail-closed.

## Estimated complexity

- [ ] Trivial (< 100 LOC, one file)
- [ ] Small (one new module, one PR)
- [ ] Medium (cross-module, may need a design discussion first)
- [ ] Large (touches the wire format / requires multi-repo coordination)
