# Generic research scripts

These three files are unchanged byte-for-byte copies of the scripts used for the recorded research and offline consistency check. They contain generic fixture names and no literal private home path. They do not include raw outputs, actual execution paths or a private consumer.

| File | SHA-256 | Recorded use |
|---|---|---|
| `reproduce.mjs` | `41be29f2031d8a45a7057b8f851ba6c2854892682bf281e4b0305c9599d464b9` | Syntax check exit 0; source-CLI reproduction exit 0; 13 fixtures and 280 child commands with expected direct exits. |
| `inspect-lint.mjs` | `3adbd6882b28d395414585094b24436f0592fa2fb30686e076b9210b6ad1a41a` | Called by the reproducer to preserve structured lint diagnostics; process exit 0 means inspection completed, not that lint had no errors. |
| `verify-receipts.mjs` | `f13d8edc595910db8a98f4ce3fb6bf5f4cc0706c8c0b0709bd19aff0526f72f4` | Offline consistency check exit 0; checked 280 saved command records and 13 fixture states without launching the source CLI, Git or a test suite. |

The comparison manifest `copy-provenance.json` records equality with the original external evidence copies. Packaging performed file reads, writes and hashing only. No CLI behavior, suite or probe was rerun for this package.

## Reproduction instructions

The recorded source commit is `1e7b15ce01ab965477e33a685b82cff0f20b8dd3`. The recorded host was macOS arm64, Node `v25.2.1`, Git `2.54.0 (Apple Git-157)`. The reproducer uses `/private/tmp` intentionally for those conditions. These instructions do not promise portability to another platform or infer live harness behavior.

The following commands are **symbolic examples, not the actual historical argv or working directories**:

```sh
node reproduce.mjs /absolute/path/to/source-checkout /absolute/path/to/new-private-evidence-directory
node verify-receipts.mjs /absolute/path/to/new-private-evidence-directory
```

Keep all three scripts together so the relative inspector import resolves. Use a new output directory: the reproducer refuses to overwrite existing evidence. It creates independent generic Git repositories and invokes the supplied source CLI in them; it refuses a dirty source checkout and checks source HEAD/status again afterward. It does not edit the source checkout, initialize a private consumer, contact a network service or run the repository test suite/gates.

Generated receipts include actual local paths. Keep generated output and the original raw bundle outside Git. The public result uses symbolic command equivalents and the raw archive hash; it does not claim those substituted examples are the original direct argv.

Source code and channel behavior are exercised through synthetic event JSON. A real harness's consumption/display, native Windows, installed launchers and performance remain separate boundaries.
