# Between project context

Updated: 2026-10-30

- Two-person rooms use server-bound platform accounts and a separate operator identity-review record. No external real-name provider is currently configured; an operator must actually perform the applicable verification before approval.
- Consent is versioned. New rooms use lifecycle=1 and a 24-hour expiry. Legacy anonymous rooms use lifecycle=0 and need explicit deletion authorization.
- Deletion closes access first, then removes R2 objects and D1 records. Durable upload jobs, conditional commits and orphan sweeps handle interrupted or late uploads. Storage errors remain retryable.
- Complaints use random receipt capabilities stored only as hashes. Operator replies and records stay private. Public GitHub issues must not receive personal materials.
- Hourly authenticated maintenance is separate from public visitor traffic. Stale or failed maintenance and aged deletion backlog suspend new room creation. GitHub schedule availability must be monitored.
- Root MIT covers application code. Preserve the OpenAI starter and vendored shadcn license notices. Runtime secrets, production identifiers/state and local build caches are excluded from the public source snapshot.
- Code tests establish behavior with synthetic fixtures, not actual identity verification, data-location facts, infrastructure log retention or legal operating compliance.
