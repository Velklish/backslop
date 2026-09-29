# Reference

How backslop works now — by the code, not by the intent. The intent and rationale are in the [ADRs](../README.md); this reference covers only the behaviour of the working version. It is split by subsystem, and each file is edited independently. The Scope field of a task links here.

| Section | Covers |
|---|---|
| [01. Layout and formats](01-layout.md) | what `init` lays down and how adapters own their outputs, the `backslop.json` fields, the task and minor file formats, the archive and its journal, ADRs, templates as the source |
| [02. CLI](02-cli.md) | every command with its flags, behaviour, output and refusals, the `status --json` shape, and what is stable for an orchestrator |
| [03. Lint gates](03-lint.md) | the fourteen gates, the checks outside them (adapter outputs, template parity, live pins), warnings, and what each catches and how to fix it |
| [04. Finding verification](04-verification.md) | the repo-local protocol for verifying bugs, dead code and test deletions, with the evidence each step requires |
