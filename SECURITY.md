# Security

## LLM-Generated Code Execution

The ScrapeKit AI Pipeline has the LLM generate Hono route handlers (TypeScript source code). This source is written to `workbench/jobs/<jobId>/api/src/routes/<resource>.ts`, compiled inside a Docker image, and run as an HTTP API.

**Trust model:** ScrapeKit treats the configured LLM as a trusted code-generator. A malicious or compromised LLM response can run arbitrary code inside the spawned Hono container.

**Mitigations:**
- Each generated container runs in an isolated Docker container on the `scrapekit-net` network.
- The container has access only to its own per-dataset Postgres DB (also containerized) — not to the workbench main DB or any user secrets.
- Dataset DB credentials are random per-spawn (`crypto.randomBytes(16)`).
- The container has no access to host filesystem outside the build context.

**Acceptable risk profile:** internal/single-tenant deployments where the operator trusts their LLM provider.

**Not acceptable for:**
- Multi-tenant deployments where users share a workbench.
- Deployments where the LLM provider is untrusted or routed through an attacker-controlled gateway.
- Deployments where the dataset DB or `scrapekit-net` is reachable by other services that hold sensitive data.

If you need stronger isolation, additional sandboxing (e.g. gVisor, kata-containers, or static analysis of the generated TypeScript before compile) is out of scope for ScrapeKit core.

## Reporting

Email security issues to the project owner; do not file public issues.
