Usage resume continues an agent on its own after a provider usage limit stopped it.

When a turn ends with a usage-limit message, the plugin reads the quota of the account
that agent runs on, waits until the depleted window has reset, and sends the agent a
short prompt asking it to continue from where it stopped.

While a resume is pending, the agent's conversation shows a status row: the limit that
was reached, the time the agent will be resumed, and afterwards whether it was resumed or
the resume was cancelled and why.

## How it decides

- A turn counts as limited when its error, or its last short message, is a usage-limit
  notice from the provider.
- The resume waits for the latest reset time among the depleted windows, plus 90 seconds.
  Per-model windows only count for agents running that model.
- A failed turn whose quota does not look depleted is retried once after 5 minutes. This
  covers short provider rate limits.
- Prompting the agent yourself, canceling the turn or archiving the agent cancels the
  pending resume.
- Only top-level agents are resumed. An agent started by another agent is left to its
  parent, which is expected to re-drive it after its own resume.
- An agent is resumed at most 4 times in a row. The count resets when one of its turns
  completes normally.

## Setup

Requires Paseo 0.15.4 or later and the `paseo` CLI on the daemon's `PATH`. Works with
providers that report quota windows, such as Claude and Codex.

## What it reads and writes

It reads the last rows of an ended turn and the account quota through `paseo usage`.
Pending resumes are saved in `usage-resume/state.json` under the daemon home, so they
survive a daemon restart. Nothing leaves the daemon machine.

## Limits

Status rows are kept in memory by the daemon and disappear when it restarts. After a
restart, a pending resume still happens, but its row is only updated once any agent has
run a turn.

Credit balances are ignored because they have no reset time. A quota whose reset time is
unknown is checked again every 10 minutes.
