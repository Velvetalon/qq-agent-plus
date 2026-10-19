# Production release records (sealed snapshots)

These 17 files preserve code records associated with the actual 91be production deployment. They are archival snapshots, not runnable deployment tools: every shell file exits 64 before its original body, and each Python file raises `SystemExit` before its original body. The original code is retained after that unconditional guard. Some deployment, recovery, and backfill scripts may perform writes; do not remove the guard or execute these snapshots. The archive does not hide the initial 500 condition or the recovery process.

Private directory strings are replaced with review-required placeholders. No runtime data is included. Hashes and archived byte counts are recorded in [manifest.json](./manifest.json).

## Snapshots

- [prepare_release_candidate.py](./prepare_release_candidate.py)
- [run_cleanup_faults.py](./run_cleanup_faults.py)
- [resume-preconditions.sh](./resume-preconditions.sh)
- [prepare-91beebbcc3.sh](./prepare-91beebbcc3.sh)
- [validate-91beebbcc3.sh](./validate-91beebbcc3.sh)
- [apply-final-91beebbcc3.sh](./apply-final-91beebbcc3.sh)
- [verify-final-worker.sh](./verify-final-worker.sh)
- [recover-code-and-diagnose.sh](./recover-code-and-diagnose.sh)
- [diagnose-account-identity.sh](./diagnose-account-identity.sh)
- [inspect-protocol-metadata.sh](./inspect-protocol-metadata.sh)
- [verify-configured-protocol-account.sh](./verify-configured-protocol-account.sh)
- [complete-authorized-configuration.sh](./complete-authorized-configuration.sh)
- [queue-authorized-existing-notes.sh](./queue-authorized-existing-notes.sh)
- [post-release-status.sh](./post-release-status.sh)
- [production-chat-smoke.sh](./production-chat-smoke.sh)
- [verify-business-data.sh](./verify-business-data.sh)
- [collect_final_release_evidence.py](./collect_final_release_evidence.py)

Related records: [workflow resume](../../schedule/2026-10-20-workflow-resume.md), [complete work archive](../../schedule/2026-10-20-complete-work-archive.md).
