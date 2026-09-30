# Measurements during a worker run

Read from `backslop-batch` when a number from a run will go into a report, task definition, or brief.

Wall-clock time in a live run measures neighbours rather than the subject: workers and their gates share one machine’s CPUs, so the number can vary by multiples. Instead of wall time, measure process CPU (user+sys) for “faster or slower”, operation counts — runs, files, requests — or arithmetic based on unit cost measured on an idle machine. Wall time is valid when the machine is idle or the text explicitly calls the measurement rough.

**Check the exit code of the command itself, not of a pipe**: `grep … | wc -l` prints `0` with exit code `0` when grep fails, so a tool failure reads as “no matches”. `npm test | tail` is the same class of mistake. Verify a zero measurement a second way.

**An incomplete answer looks as confident as a complete one.** `\s` in `git grep -E` is not portable: on macOS it silently matches nothing. Use POSIX classes such as `[[:space:]]`. A character class written for particular names misses a neighbour containing a digit; checking a literal with a glob tests whether something with that prefix exists, not the recorded value. Check the exact literal you wrote down.

**When counting calls, count calls of exactly what the check names, filtered by arguments:** `git` invocations are not `git merge` invocations. **Grep treats text as flat:** “found in a comment” is a hypothesis until language scopes are parsed.

**A gate run on a tree that is not byte-for-byte the commit proves nothing about the commit.** A test stand — container, clone, copy — is built from the whole tree; equality means `diff -r` is empty or `git status` in the stand is clean. For project gates, use `{{cli}} gates --require-clean`.

`--measurements` carries only the three-point summary of these rules into a brief; any other rule from this file goes into the brief by hand, e.g. through `--handover`. Only the orchestrator reads this file.
