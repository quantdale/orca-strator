# Design: End-to-End Autonomy Qualification

## 1. Summary

Change 008 organizes the full-matrix qualification tests in `apps/controller/test/e2e-autonomy-qualification.test.ts`.

Test scenarios cover:
1. **Multi-Environment Multi-Repo Matrix**:
   - Repo A (Windows PowerShell adapter) and Repo B (WSL adapter).
   - Independent Sol conversation endpoints.
   - Concurrent execution without deadlock or shared state corruption.
2. **Crash and Reboot Reconstruction**:
   - Mid-turn executor crash -> `RECOVERY_REQUIRED` on startup.
   - User resolves recovery with `retry` -> resumes loop to `SOL_PENDING` / `SOL_REVIEWING`.
3. **Ceiling & Draining Enforcement**:
   - Iteration limits and wall-clock budget triggers `DRAINING` -> `GOAL_COMPLETE`.
4. **Tailscale & Alert Verification**:
   - System guidance and notification filtering.
