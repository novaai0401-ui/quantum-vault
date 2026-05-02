<!--
Thanks for contributing to Sigvault. A few quick checks before we merge.
-->

## Summary

<one paragraph: what changed, why>

## Relates to / closes

<#issue or RFC>

## Type

- [ ] feat — new operator-visible capability
- [ ] fix — corrects misbehaviour
- [ ] perf — measurable speed/memory win
- [ ] refactor — no behaviour change
- [ ] docs
- [ ] chore — tooling, CI, build, brand
- [ ] test
- [ ] security

## Checklist

- [ ] `cd qv-server && npm test` passes locally
- [ ] No new npm dependencies added (or: justified exception in description)
- [ ] No new transitive deps in any language adapter
- [ ] If wire format / HTTP shape / error code changed → `qv-spec/` updated in this PR
- [ ] If a new server module → at least one unit test file added
- [ ] If a new operator-visible env var → documented in `docs/story/16-operations.md`
- [ ] If a new error code → added to `qv-spec/error-codes.md`
- [ ] No secrets / tokens / signing keys printed to stdout, audit log, or test output
- [ ] Commits are signed off (`git commit -s`) with DCO

## Test evidence

<paste the last ~10 lines of `npm test` output>

## Reviewer notes

<anything that helps the reviewer skip dead ends>
