# Deployment prerequisite: Notebook prompt boundary

Scope: qq-agent-plus only, based on main
`2be4bccce643d4d40bdc4472e5703f3a109aac2e`.

Before implementation, the existing prompt-safety test reproduces 5 passes and
2 failures. Restore the six explicit Notebook capability and safety statements
in the shared role-note policy without removing its subjective-role, scoped CAS,
partial-read, or operational-memory restrictions. Do not alter test assertions,
stored data, classifier logic, runtime mode, dependencies, or credentials.

Validate the unchanged prompt tests and related synthetic memory regressions,
then run the repository gates with temporary data. A passing focused test is
not Social acceptance. SSH TCP is currently refused; no production changes are
permitted until connectivity, supported authentication, project ownership,
candidate acceptance, and reversible backup are established. Keep deployment
blocked if any required gate remains missing.
