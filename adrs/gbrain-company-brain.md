# A self-hosted company brain over MCP

We run an open-source knowledge brain (gbrain) as our company memory: one Postgres-backed
instance per org, hybrid search over company docs and everything our agents have written,
served over HTTP MCP with OAuth 2.1. We want QM scopes to read and write it.

This overlaps with the TinyFish request in #66, but the endpoint differs in one way that
matters: ours is self-hosted, so the URL is per-deployment, not a vendor constant. We'd
want to name the server and its issuer in the deployment directory rather than have QM
learn about each brain vendor individually. If #66 lands as a general "deployment declares
an OAuth MCP server" mechanism, that covers us.

The credential ownership rule in #66 is the part we care most about. Our brain enforces
isolation per credential: a client is scoped to the sources it may read and, as of our
latest release, the slug prefixes it may write. So each employee scope needs its own
client, and channel scopes need their own too — a room can't inherit a person's connection
or the write fencing collapses. Per-scope, not just per-person.

We got this working today without any QM change by baking our CLI into the sandbox image
as a tool and letting the agent shell out to it. It works, and the per-scope isolation
holds, but two things are awkward: `sandbox.secretEnv` only forwards org-wide secrets, so
there's no first-class way to hand each scope its own client credentials — we bootstrap
them into `~/.gbrain/config.json` on the durable disk once per sandbox and rely on
`auth.credentialPaths` to keep them there. And retrieval is agent-initiated through a
skill, so it only happens when the model remembers to run it.

I verified the whole path end to end: registered one OAuth client per employee, connected
two sandboxes as thin clients, and confirmed a client can write its own and its channels'
prefixes and gets a permission error on anything else, while reads stay scoped to the
sources it was granted.
