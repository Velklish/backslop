# Reference

How backslop works now — by the code, not by the intent. The intent and rationale are in the [ADRs](../README.md); this reference covers only the behaviour of the working version. It is split by subsystem, and each file is edited independently. The Scope field of a task links here.

| Section | Covers |
|---|---|
| [01. Layout and formats](01-layout.md) | what `init` lays down and how adapters own their outputs, the `backslop.json` fields, the task and minor file formats, the archive and its journal, ADRs, templates as the source, the agent hook files and protocols of Claude Code, Codex and Cursor |
| [02. CLI](02-cli.md) | every command with its flags, behaviour, output and refusals |
| [03. Lint gates](03-lint.md) | the fifteen gates, the checks outside them (adapter outputs, template parity, live pins, agent hook records), warnings, and what each catches and how to fix it |
| [04. Finding verification](04-verification.md) | the repo-local protocol for verifying bugs, dead code and test deletions, with the evidence each step requires |
| [05. Orchestrator contract](05-orchestrator-contract.md) | what an orchestrator or a script may rely on: output channels, exit codes, the JSON of `status`, `gates`, `tracks`, `links --external` and `seed --scan`, the brief, the commands that change files, and what is stable |
| [06. Module map](06-module-map.md) | where each part of `lib/` lives: dispatch, the modules with their exports, and step-by-step recipes for a command, a lint gate, a migration and a template placeholder, the test helpers and the help text |
