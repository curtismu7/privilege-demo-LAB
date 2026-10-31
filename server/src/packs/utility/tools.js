// The utility pack's tools. EVERY backend here is a MOCK: deterministic fake results, no GitHub, Confluence, backlog, CloudWatch or
// deploy system is ever called. The results say so ("mock": true) so a screen capture cannot be mistaken for a real system.
// Each tool belongs to an app (Cedar context.app). resource(args) gives the Cedar resource attributes of the call's target:
//   toolName        the tool's own name (lets one policy cover every deploy.* tool with a `like` pattern)
//   repo            for GitHub tools: which repository (per-repo scoping)
//   classification  "internal" or "restricted": looked up HERE from the mock catalog, never taken from the caller.
// An argument value the catalog does not know is classified "restricted" (fail closed), though the argument check refuses it first.
import { createHash } from 'node:crypto';

export const REPOS = ['grid-ops-portal', 'outage-notifier', 'meter-data-lake'];
export const KB_COLLECTIONS = { runbooks: 'internal', 'design-notes': 'internal', 'audit-evidence': 'restricted' };
export const LOG_GROUPS = { 'portal-app': 'internal', 'notifier-app': 'internal', 'security-events': 'restricted' };

const short = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 6).toUpperCase();
const str = { type: 'string' };
const pr = { type: 'integer', minimum: 1 };
const repo = { type: 'string', enum: REPOS };
const schema = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const mockResult = (o) => ({ mock: true, ...o });

const base = (name) => ({ toolName: name, classification: 'internal' });
const repoTool = (name) => (a) => ({ ...base(name), repo: a.repo });
const catalogTool = (name, key, catalog) => (a) => ({ ...base(name), classification: Object.hasOwn(catalog, a[key]) ? catalog[a[key]] : 'restricted' });
const plain = (name) => () => base(name);

export const UTILITY_TOOLS = [
  { name: 'github.read_pr', app: 'github', description: 'Read a pull request (mock GitHub).', inputSchema: schema({ repo, pr }),
    resource: repoTool('github.read_pr'),
    run: (a) => mockResult({ repo: a.repo, pr: a.pr, title: 'MOCK: Show planned-outage window', state: 'open', files: 3, additions: 41, deletions: 7 }) },
  { name: 'github.post_review_comment', app: 'github', description: 'Post a review comment on a pull request (mock GitHub).', inputSchema: schema({ repo, pr, body: str }),
    resource: repoTool('github.post_review_comment'),
    run: (a) => mockResult({ repo: a.repo, pr: a.pr, commentId: `CMT-${short(a.body)}`, posted: true }) },
  { name: 'github.merge_pr', app: 'github', description: 'Merge a pull request (mock GitHub). Policy always denies it.', inputSchema: schema({ repo, pr }),
    resource: repoTool('github.merge_pr'), run: (a) => mockResult({ repo: a.repo, pr: a.pr, merged: true }) },
  { name: 'github.approve_pr', app: 'github', description: 'Approve a pull request (mock GitHub). Policy always denies it.', inputSchema: schema({ repo, pr }),
    resource: repoTool('github.approve_pr'), run: (a) => mockResult({ repo: a.repo, pr: a.pr, approved: true }) },
  { name: 'kb.search', app: 'kb', description: 'Search the knowledge base (mock). The audit-evidence collection is restricted.', inputSchema: schema({ query: str, collection: { type: 'string', enum: Object.keys(KB_COLLECTIONS) } }),
    resource: catalogTool('kb.search', 'collection', KB_COLLECTIONS),
    run: (a) => mockResult({ collection: a.collection, query: a.query, hits: [{ id: `KB-${short(a.query)}`, title: `MOCK ${a.collection} result` }] }) },
  { name: 'cloudwatch.query_logs', app: 'cloudwatch', description: 'Query a log group (mock CloudWatch). The security-events group is restricted.', inputSchema: schema({ logGroup: { type: 'string', enum: Object.keys(LOG_GROUPS) }, query: str }),
    resource: catalogTool('cloudwatch.query_logs', 'logGroup', LOG_GROUPS),
    run: (a) => mockResult({ logGroup: a.logGroup, query: a.query, rows: 3 }) },
  { name: 'backlog.create_story_draft', app: 'backlog', description: 'Create a draft story in the backlog (mock).', inputSchema: schema({ title: str }),
    resource: plain('backlog.create_story_draft'), run: (a) => mockResult({ storyId: `ST-${short(a.title)}`, title: a.title, status: 'draft' }) },
  { name: 'backlog.update_story', app: 'backlog', description: 'Update an existing story in the backlog (mock). Held for approval.', inputSchema: schema({ storyId: str, change: str }),
    resource: plain('backlog.update_story'), run: (a) => mockResult({ storyId: a.storyId, change: a.change, status: 'updated' }) },
  { name: 'confluence.update_requirement', app: 'confluence', description: 'Update a requirement page (mock Confluence). Held for approval.', inputSchema: schema({ requirementId: str, change: str }),
    resource: plain('confluence.update_requirement'), run: (a) => mockResult({ requirementId: a.requirementId, change: a.change, version: 'v2-mock' }) },
  { name: 'policy.change', app: 'policy', description: 'Change an access policy (mock). Policy always denies it.', inputSchema: schema({ policyId: str, change: str }),
    resource: plain('policy.change'), run: (a) => mockResult({ policyId: a.policyId, changed: true }) },
  { name: 'deploy.staging', app: 'deploy', description: 'Deploy to staging (mock). Every deploy.* tool is always denied.', inputSchema: schema({ service: str }),
    resource: plain('deploy.staging'), run: (a) => mockResult({ service: a.service, env: 'staging', deployed: true }) },
  { name: 'deploy.production', app: 'deploy', description: 'Deploy to production (mock). Every deploy.* tool is always denied.', inputSchema: schema({ service: str }),
    resource: plain('deploy.production'), run: (a) => mockResult({ service: a.service, env: 'production', deployed: true }) },
  { name: 'deploy.rollback', app: 'deploy', description: 'Roll a deployment back (mock). Every deploy.* tool is always denied.', inputSchema: schema({ service: str }),
    resource: plain('deploy.rollback'), run: (a) => mockResult({ service: a.service, rolledBack: true }) },
].map((t) => ({ ...t, mock: true })); // every tool in this pack is a mock backend
