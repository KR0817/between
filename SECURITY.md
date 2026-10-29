# Security and operations

Report security issues privately to glah1005@163.com. Do not post room invitations, account identifiers, complaints, message contents, documents or credentials in public GitHub issues. Include a minimal synthetic reproduction and affected version.

## Trust boundary

The deployed application relies on Sites dispatch to authenticate visitors and supply trusted oai-authenticated-user-id and oai-authenticated-user-email headers. Never expose this Worker directly on an untrusted origin that allows callers to forge those headers. A self-hosted fork needs an authenticating proxy that strips and replaces them, or a reviewed authentication implementation. Local tests intentionally simulate this trust boundary; they do not prove the hosted identity provider.

OPERATOR_EMAIL grants administrator privileges only when it matches the trusted identity email. MAINTENANCE_TOKEN grants bounded storage cleanup only. Configure both in the hosting secret settings; keep the maintenance token in the GitHub repository's Actions secrets as well. Never put either authentication secret in source, a URL, command arguments, screenshots or public workflow output. Delete rights and operator review are separate from maintenance credentials.

Manual verification records must refer to a real verification performed through a lawful procedure. A checked box, ChatGPT login or self-declared name does not itself establish real identity. No paid verification provider is included or activated. Do not approve users before the procedure and legal applicability are settled. Revoke approval when evidence expires or is invalidated.

## Retention operations

The maintenance workflow runs hourly at minute 17 and can also be dispatched manually. Each invocation processes a bounded batch and retries storage failures on a later run. Check its result and the administrator dashboard's last successful cleanup time. New room creation stops when the successful maintenance heartbeat is stale. Existing room expiry and explicit deletion close access independently of cleanup.

GitHub scheduled jobs can be delayed or dropped. In public repositories, GitHub automatically disables schedules after 60 days without repository activity. The operator must monitor and re-enable the workflow, or move the same authenticated cleanup call to a continuously operated scheduler. This is a best-effort maintenance system, not a guaranteed deletion-time SLA. See the [official schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Old anonymous data is not automatically erased during deployment. Review the retention policy and use the explicit legacy-cleanup control to authorize deletion of expired legacy records. Do not claim legacy cleanup occurred until the action and subsequent storage cleanup succeed. Downloaded copies on participants' devices and hosting backups are outside application-level erasure.

## Remaining operating prerequisites

Confirm actual processing locations, processor contracts, hosting backup/network-log retention, applicable cross-border procedures and local filing requirements before sustained public operation. The application audit trail is not evidence that all infrastructure network logs meet statutory requirements. Use an appropriate verification provider for scalable real-name verification. The code and tests do not constitute a legal compliance certification.
