# Between governance update

Date: 2026-10-30. Owner: Xinbo Yu. Public contact: glah1005@163.com.

## Scope and operating limits

Preserve two-person chat and transfers. Add platform authentication followed by a separate operator-reviewed identity record, privacy acceptance, deletion, private complaints and operator review. No identity provider is configured. Platform login is not legal real-name verification; pending users cannot communicate. Manual approval requires an actual verification method and an external evidence reference, not a self-declared name. Legal adequacy of the operator's verification procedure remains an operational prerequisite. Do not collect identity-document images in this app.

Publish the source under MIT to KR0817/between. Preserve third-party notices. Publish an independently sanitized source snapshot, without local records, credentials, build caches or production database state. Preserve the existing public Site audience; endpoints enforce identity and consent.

## API contract

All mutations are POST, same-origin checked. Trust Sites-provided authenticated-user headers only behind Sites dispatch. A direct Worker deployment must install an authenticated proxy that strips client identity headers. Local test harness uses synthetic trusted headers only in an isolated local runtime.

- GET /api/account: { signedIn, member, email, admin, accepted, verification, verifiedUntil }. Anonymous state has empty member/email and no privileges. Verification is none, pending, verified, rejected or revoked.
- POST /api/account/consent: { version: "2026-10-30", accept: true, adult: true }. Acceptance is versioned. The service is for adults only.
- POST /api/account/verification: request operator review after acceptance. No documents submitted. Contact the published operator with the account reference for the actual verification arrangement.
- POST /api/account/delete: revoke access/acceptance and queue managed rooms for deletion. Retain only separately justified audit records until their documented expiry.
- Existing room/message/file routes keep response shapes; derive the member from trusted login, ignoring x-member for new rooms. Every communication call requires current consent and an unexpired approved verification. New rooms use lifecycle=1; old rooms default lifecycle=0 and are inaccessible to communication.
- POST /api/rooms/delete: require member ownership (or legacy room capability plus original member UUID only for legacy deletion); close both participants' access and queue deletion. Return { status: "queued" }.
- POST /api/complaints: { category: "privacy" | "content" | "account" | "other", details, contact? }. Optionally authenticate x-room before linking a room. Return { receipt, status, created }. Receipt is random, stored hashed, and shown once. Public intake is bounded and rate-limited.
- POST /api/complaints/status: { receipt }. Return status, reply, created, updated only; never return the original submission/contact or another person's details.
- GET /api/admin/overview: authorized operator only. Return pending accounts, complaints, lifecycle counts and last maintenance status; no chat text or file data.
- POST /api/admin/verification: { accountId, decision: "verified" | "rejected" | "revoked", method: "document" | "verified_phone" | "trusted_provider", reference, attested: true }. Require method/reference and explicit attestation for approval; maximum 180-day review validity. Store minimal audit reference, not the underlying documents.
- POST /api/admin/complaints: { id, status: "in_progress" | "resolved" | "rejected", reply, closeRoom?: boolean }. Record a private response; optionally close the linked room.
- POST /api/admin/cleanup: operator invokes the same bounded retryable cleanup as maintenance.
- POST /api/admin/legacy-cleanup: { confirm: true }. Explicit operator action queues expired legacy data only. Do not retroactively delete legacy data on deployment.
- POST /api/maintenance: require a constant-time checked, high-entropy bearer MAINTENANCE_TOKEN. Bounded cleanup; return counts/status only. GitHub Actions calls hourly, with repository secrets, never logs response bodies or credentials. Scheduled execution is best-effort, monitored via workflow results and maintenance status.

## Retention

Managed rooms close after 24 hours or a member deletion request. Hourly cleanup erases R2 attachments before removing metadata. A tombstone and durable upload job prevent upload/delete races; late uploads are discarded, failures retried. Mark physical completion only after storage operations succeed. Under normal scheduler operation cleanup starts within the next run; never promise an exact deletion deadline. Platform backups/logs have separate, currently unverified retention.

Complaint contents: 30 days after resolution, capped at 180 days since receipt. Identity-review records: while account exists; deleting the account removes its operational record. Minimal security/audit events: 186 days (at least six calendar months), without chat text, attachments, raw documents or receipt tokens. Account deletion does not silently erase legally justified security records. Existing legacy content requires the explicit legacy cleanup action.

## Acceptance

1. Unauthenticated, unapproved, expired-verification and stale-consent users cannot create/join/read/send/upload/download. A forged x-member cannot impersonate another approved account; operator APIs deny other users.
2. Two approved synthetic identities exchange both text directions and identical file bytes; a third identity is denied. Existing limits remain enforced.
3. A member closes a room immediately; after maintenance the corresponding local D1 rows and R2 keys are absent. A delayed upload cannot resurrect a deleted room. Failed deletion is retryable; expiry works without visitor traffic through the configured scheduler.
4. Complaints have unguessable receipts, rate bounds, operator replies, optional room closure, private lookup and documented expiry.
5. Production build and TypeScript pass. Visually inspect desktop/mobile primary and governance flows when the browser runtime permits.
6. Scan the exact open-source snapshot for secrets, local paths/data and license completeness before publishing. Verify public repository and deployed version. Real external identity verification and legal compliance are not established by synthetic tests.
