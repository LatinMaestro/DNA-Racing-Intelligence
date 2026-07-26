# Phase 9 hosted accessibility attestation

Status: synthetic, non-executable evidence contract.

## Purpose

Bind accessibility and responsive verification to one exact candidate head,
reviewed route manifest and WCAG 2.2 AA target.

Required evidence covers:

- semantic structure;
- keyboard navigation;
- focus management;
- assistive-technology names, roles and states;
- visual contrast and non-colour status communication; and
- responsive reflow.

Each scope records a fixed command identifier, exact UTC execution bounds,
redacted-summary digest, route and checkpoint coverage, automated violations
and manual findings. Evidence must come from an authenticated owner workspace
using synthetic private states only.

Missing scopes remain review-required. Stale heads, command substitution, route
drift, incomplete manual review, any accessibility finding, private-data
observation or retained private artifact block the projection.

This contract does not claim that the checks executed. It cannot dispatch
Actions, merge a pull request, expose a route or mutate Production.
