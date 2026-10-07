# BeMerged AI Governance Migration Plan

## Purpose

Unify AI mode, capability, and contract semantics across bridge, scene, planner, and server using a single governance manifest.

## Source Of Truth

- `aiGovernanceManifest.ts`
  - commands
  - goals
  - delay bounds
  - action allow-list policy
  - strict guardrails
  - invariants

## Phase 1 (Completed)

- Bridge command validation now consumes governance command/goal/delay constants.
- Scene capabilities now emit governance-backed `actions` and `strictGuardrails`.
- Scene autoplay now applies swap-only policy to both:
  - model-driven branch
  - built-in autoplay branch
- Planner prompt + parser now consume runtime-provided `allowedActionTypes`.
- Bridge payload now includes drift report against scene capabilities.

## Phase 2 (Next)

- Server runtime must expose same objective model identifier as client governance.
- Headless capabilities should advertise governance schema version and invariant status.
- Add server/client contract parity check in CI.

## Phase 3 (Next)

- Add integration tests for `aiDevControls` policy:
  - disabled => swap-only for all autoplay paths
  - enabled + mode=dev => full governed action set
- Add drift regression test fixture for malformed scene capability surfaces.

## Required Invariants

1. `testingMode=true` only when `mode=dev`.
2. Planner visible actions must equal runtime-allowed actions.
3. Swap-only policy applies globally, not model-only.
4. Delay bounds are identical across tool, bridge, and runtime.
5. Objective semantics in payload fields are internally consistent.

## Rollout Safety

- Keep bridge error codes deterministic.
- Prefer additive payload fields during transition (`governanceSchemaVersion`, drift block).
- Treat drift detection as warning-first until server parity is complete.
