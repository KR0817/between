# Between

> Version 0.2 adds authenticated, reviewed access and data-governance controls. Read this section before the legacy v1 notes below.

[Live Site](https://between-pair-chat-yxb.betzoqrcr9gfgp.chatgpt.site) · [Governance center](https://between-pair-chat-yxb.betzoqrcr9gfgp.chatgpt.site/governance) · [Source](https://github.com/KR0817/between)

## Current operation

1. Sign in through the hosting platform, review the privacy/service notice, and confirm that you are an adult. Acceptance is recorded against the policy version.
2. Request identity review and contact the published operator for a lawful verification arrangement. No external identity provider is currently configured. Platform login alone does not count as real-name verification. Pending users cannot communicate; an operator must record a real verification and its minimal evidence reference before approval.
3. After approval, create a room and share its invitation with one other approved account. The two fixed seats belong to authenticated accounts. Send text or files up to 20 MiB each.
4. Either participant can close the room and request deletion for both people. Access ends immediately. The maintenance job removes stored objects and metadata with retry handling. An already-downloaded copy cannot be recalled.

The governance center contains a privacy notice, account withdrawal/deletion, public complaint intake, secret receipt lookup, and operator controls for identity review, complaint responses, room closure and storage cleanup. Operator: Xinbo Yu; contact: glah1005@163.com. Do not send identity-document images or patient data to this app or public GitHub issues.

## Retention and limits

New rooms expire after 24 hours. Cleanup runs hourly at minute 17, subject to scheduler availability. Storage errors remain retryable; late uploads are checked again and orphan objects are swept. The application distinguishes closed access from completed storage deletion. New rooms are blocked when maintenance has not succeeded recently.

Complaints expire 30 days after resolution, with a maximum of 180 days after receipt. Minimal application security/audit events are retained for 186 days, separately from chat content. Hosting backups and network logs have their own retention, which has not been verified. Legacy v1 rooms require the operator's explicit legacy-cleanup action; deployment does not silently purge them.

GitHub Actions may delay scheduled runs and disables schedules in inactive public repositories after 60 days. The operator must monitor/re-enable scheduling or run the same endpoint from a continuously operated scheduler. Check the administrator maintenance status and workflow results. These controls do not establish legal compliance or a guaranteed deletion SLA.

## Development

Requires Node.js 22.13+ and npm. Preserve the lockfile and Sites build integration.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The governance test bundles the actual route handler into an isolated Miniflare Worker with ephemeral D1/R2. It uses only synthetic identities, in-memory test secrets and generated data. It does not read environment files or access the production service. The older smoke/boundary scripts below describe the retired anonymous v1 contract.

Apply all committed SQL migrations in order to a fresh local D1 before running the preview. Hosted migrations are applied through Sites deployment. Never edit a previously applied migration or load production records into a public test artifact.

## Deployment and operator setup

Configure runtime `OPERATOR_EMAIL` to the email of the trusted hosting-platform account that will administer the service. Configure a random, at least 32-character `MAINTENANCE_TOKEN` as a secret. Configure the same token as the repository Actions secret and the public origin as the Actions variable `SITE_ORIGIN`. The workflow has no repository write permissions and never prints secrets or server response bodies. Dispatch it once and verify success before accepting traffic.

The source distribution omits the original Site project ID. A fork must create its own Site and storage, preserve the `DB` and `BUCKET` bindings, and use its own runtime configuration. Never expose the Worker directly while trusting caller-supplied platform identity headers. See [SECURITY.md](SECURITY.md), [Compliance-Spec.md](Compliance-Spec.md), [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

