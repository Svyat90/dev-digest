import { AgentEvalDashboardView } from "./_components/AgentEvalDashboardView";

/* Route: /evals/:agentId (agent Eval Dashboard). Thin route entry — the view
   lives in _components/AgentEvalDashboardView. */
export default function AgentEvalDashboardPage() {
  return <AgentEvalDashboardView />;
}
