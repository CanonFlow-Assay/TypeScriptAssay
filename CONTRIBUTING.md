# Contributing

Use Node `20.20.2` and npm `10.8.2`. Before opening a pull request, run `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

Rule changes require stable ID, rationale, observation limit, good and bad fixtures, unit coverage, catalog documentation, `explain` output, and deterministic receipt/SARIF evidence. Do not weaken a policy, hide a finding, broaden an ignore, or alter a converge baseline merely to make a run green.
