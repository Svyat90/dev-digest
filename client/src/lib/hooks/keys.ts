/* React Query key factory — one place for every cache key, so an invalidation
   in one hook reaches every consumer. The array VALUES are part of the cache
   contract (docs/ui-architecture.md, "Cache keys"): never change a shape here
   without changing every reader and invalidator with it. */
type Id = string | null | undefined;

export const keys = {
  repos: () => ["repos"] as const,
  pulls: (repoId: Id) => ["pulls", repoId] as const,
  pull: (prId: Id | number) => ["pull", prId] as const,
  reviews: (prId: Id) => ["reviews", prId] as const,
  prRuns: (prId: Id) => ["pr-runs", prId] as const,
  prActiveRuns: (prId: Id) => ["pr-active-runs", prId] as const,
  prComments: (prId: Id) => ["pr-comments", prId] as const,
  runTrace: (runId: Id) => ["run-trace", runId] as const,
  agents: () => ["agents"] as const,
  agent: (id: Id) => ["agent", id] as const,
  providerModels: (provider: Id) => ["provider-models", provider] as const,
  /** Prefix matching every provider — for invalidation only. */
  providerModelsAll: () => ["provider-models"] as const,
  settings: () => ["settings"] as const,
  secretsStatus: () => ["secrets-status"] as const,
  repoIntelState: (repoId: Id) => ["repo-intel-state", repoId] as const,
  context: (repoId: Id) => ["context", repoId] as const,
  skills: () => ["skills"] as const,
  skill: (id: Id) => ["skill", id] as const,
  skillVersions: (id: Id) => ["skill-versions", id] as const,
  skillVersion: (id: Id, version: Id | number) => ["skill-version", id, version] as const,
  skillStats: (id: Id) => ["skill-stats", id] as const,
  agentSkills: (agentId: Id) => ["agent-skills", agentId] as const,
  conventions: (repoId: Id) => ["conventions", repoId] as const,
  intent: (prId: Id) => ["intent", prId] as const,
  smartDiff: (prId: Id) => ["smart-diff", prId] as const,
  brief: (prId: Id) => ["brief", prId] as const,
  blast: (prId: Id) => ["blast", prId] as const,
  /** Prefix matching every PR's blast radius — for invalidation only. */
  blastAll: () => ["blast"] as const,
  contextDocs: (repoId: Id, q: string) => ["context-docs", repoId, q] as const,
  contextDoc: (repoId: Id, path: Id) => ["context-doc", repoId, path] as const,
  contextDocUsage: (path: Id) => ["context-doc-usage", path] as const,
  /** Prefix matching every path's usage — for invalidation only. */
  contextDocUsageAll: () => ["context-doc-usage"] as const,
  agentContextDocs: (agentId: Id, repoId: Id) => ["agent-context-docs", agentId, repoId] as const,
  /** Prefix matching every agent's context docs — for invalidation only. */
  agentContextDocsAll: () => ["agent-context-docs"] as const,
  skillContextDocs: (skillId: Id, repoId: Id) => ["skill-context-docs", skillId, repoId] as const,
  prHistory: (prId: Id) => ["pr-history", prId] as const,
  agentEvalCases: (agentId: Id) => ["agent-eval-cases", agentId] as const,
  agentEvalRuns: (agentId: Id) => ["agent-eval-runs", agentId] as const,
  /** Prefix matching every agent's eval runs — for invalidation only. */
  agentEvalRunsAll: () => ["agent-eval-runs"] as const,
  /** One case of either owner, opened in the Case Editor. */
  evalCase: (kind: Id, ownerId: Id, caseId: Id) => ["eval-case", kind, ownerId, caseId] as const,
  /** Prefix matching every opened case — for invalidation only. */
  evalCasesAll: () => ["eval-case"] as const,
  skillEvalCases: (skillId: Id) => ["skill-eval-cases", skillId] as const,
  skillEvalRuns: (skillId: Id) => ["skill-eval-runs", skillId] as const,
  skillEvalAgent: (skillId: Id) => ["skill-eval-agent", skillId] as const,
  evalDashboard: () => ["eval-dashboard"] as const,
  agentEvalDashboard: (agentId: Id, range: Id) => ["agent-eval-dashboard", agentId, range] as const,
  /** Prefix matching every range of one agent's dashboard — for invalidation only. */
  agentEvalDashboardAll: (agentId: Id) => ["agent-eval-dashboard", agentId] as const,
  /** Prefix matching every agent's dashboard — for invalidation only. */
  agentEvalDashboardPrefix: () => ["agent-eval-dashboard"] as const,
  evalRunComparison: (agentId: Id, a: Id, b: Id) => ["eval-run-comparison", agentId, a, b] as const,
  /** Prefix matching every comparison — for invalidation only. */
  evalRunComparisonAll: () => ["eval-run-comparison"] as const,
};
