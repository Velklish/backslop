# Closed task journal

One line per task: number with slug, closing date, outcome, closing commit, and title. The body is not in the tree — the definition and the result live in git, and `{{cli}} show N` retrieves them. Lines are appended at the end: a single fold adds its own line, a bulk fold adds its lines by closing date, equal dates by number.

An `—` outcome means that `result.md` did not name one. An `—` commit means that the body went into the message of the folding commit, and `show` looks it up by the `{{prefix}}-N:` subject.
