# BS-238 · Final cleanup of public history and release artifacts

- **Scope:** [Archive and retrieval](../../reference/02-cli.md), [verification](../../reference/04-verification.md), public Git history and hosted release artifacts
- **Created:** 2026-10-04
- **Dependencies:** BS-233, BS-234, BS-235, BS-236, BS-237
- **Cost:** major

## Context

Cleaning the current tree does not remove employer-specific information from older commits or hosted publications. This is the final publication-cleanup step after current content, product boundaries and preventive checks have been corrected.

Source: owner request on 2026-10-04. BS-233 through BS-237 cover current content and explicitly leave Git-history rewriting outside their implementation. The earlier audit did not inventory all published refs, author metadata, hosted discussions, release assets or external copies. Do not describe an uninspected surface as clean or an unverified local occurrence as published.

Closed task bodies are stored in commit messages, and archive records resolve revisions. A file-only cleanup or replacement of the repository with a single new root commit can lose task retrieval. The plan must preserve useful history and archive behavior.

Source: [GitHub history-removal procedure](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) and [git-filter-repo documentation](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt). Rewriting refs does not remove third-party clones, forks or every cached/PR reference. Support assistance is subject to its sensitive-data policy, not guaranteed for ordinary organization mentions.

## Work to do

1. Inventory actual published exposure: all relevant branches and tags, file contents and paths, commit/tag messages, author and committer metadata, task archives, Issues, PRs, Releases, Actions logs/artifacts, Pages, LFS and published packages where present. Keep exact employer identifiers and cross-project findings in private coordination records, not in this public card.
2. Coordinate a publication freeze and preserve a private backup, including local unpublished work. For every affected public repository, prepare and execute its cleanup separately under that repository's rules. This card tracks final completion without copying another project's implementation here.
3. Prepare a scoped removal/replacement plan. Preserve authorship and required attribution; replace employer-specific contact details appropriately. If credentials are found, revoke or rotate them before relying on history cleanup.
4. Rewrite a disposable clone with git-filter-repo, covering the relevant refs and metadata. Keep an old-to-new revision map privately. Repair archive references and verify historical task retrieval after the rewrite.
5. Validate the rewritten history and release artifacts before any remote replacement. Account for changed commit hashes, signatures, release tags, dependency pins and lockfiles. Do not silently republish changed content under an existing release identity.
6. Present the exact refs, affected artifacts, validation and rollout plan for owner approval. Only then replace remote history or change/delete hosted material. Address retained PR/cache references with Support where applicable, and coordinate known forks/clones without promising deletion of copies outside our control.
7. Re-clone or carefully clean participating worktrees and dependencies before resuming publication. Prevent stale branches, backups and agent worktrees from reintroducing old history. Record the final remote readback and unresolved external copies.

## Out of scope

- Rewriting or force-pushing history while merely filing this card.
- Uninstalling tracker-owned files, hooks or documentation.
- Publishing sensitive search dictionaries, raw findings or dirty backups as evidence.
- Guaranteeing that nobody retained a copy of previously public material.

## Verification

- Every inventoried surface is marked checked, cleaned, absent or unresolved with evidence. The scan covers history and metadata, not only HEAD.
- A fresh clone of the rewritten published refs passes the agreed content checks, repository gates and archive retrieval checks. Historical task ids, outcomes and links remain usable.
- Release artifacts and installations from the new refs are checked independently of the working clone. Updated consumers resolve the intended revisions.
- No stale automation/worktree can publish old refs unnoticed; preventive checks cover new commits and publication artifacts.
- The report records source and resulting SHAs, commands, exit codes, affected refs and known limits. Unresolved forks/caches remain explicit findings, not a claim of complete erasure.

## Deferred

- **Deferred:** 2026-10-04
- **Reason:** Final step after the current-tree boundary cleanup. Rewriting first would leave present violations and allow ongoing work to republish the old history.
- **Return condition:** BS-233 through BS-237 are complete; corresponding current-tree cleanup and preventive checks are complete in every affected public project; a publication freeze and private evidence inventory can be prepared. Remote replacement still requires approval of the concrete validated plan in this card.
