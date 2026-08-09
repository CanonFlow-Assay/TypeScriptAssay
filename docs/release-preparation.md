# Release preparation

This repository prepares a local npm package for review; it does not publish a package, create a release, or add release automation.

`package.json` is deliberately non-private and limits the packed surface to the built CLI (`dist`) and the public repository documents. The test suite builds the project, runs `npm pack`, installs that exact tarball into a fresh temporary project, and executes the installed binary's `--help`, `doctor`, `scan`, and `verify` commands. The temporary consumer has an explicit policy and a passing required command. `scan` is expected to be non-authoritative because it does not run that command; `verify` must be authoritative.

The package SHA-256 and command evidence for the reviewed tarball are recorded in [the 0.1.0 release-preparation evidence](evidence/release-preparation-0.1.0.json). Recheck npm registry name availability and account/organization ownership immediately before any separate human publish decision.

No command in this repository invokes `npm publish`.
