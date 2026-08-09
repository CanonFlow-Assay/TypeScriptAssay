# Scope and profiles

`domainGlobs` and `boundaryGlobs` name the only source files inspected. `excludedGlobs` records matching files removed from that candidate scope. The receipt lists scanned paths, excluded paths, and every unmatched glob. An unmatched inclusion glob makes scope incomplete and authority false. An unmatched exclusion is visible but does not invent omitted source.

`new` blocks every configured error finding. `converge` requires a reviewed baseline entry containing the exact finding fingerprint, rationale, reviewer, and review date. Baseline findings remain in the receipt with `baseline: true`; a new fingerprint blocks. The tool never rewrites a baseline.
