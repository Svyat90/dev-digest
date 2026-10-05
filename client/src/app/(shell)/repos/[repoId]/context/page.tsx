import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context. Thin route entry — the view lives in
   _components/ProjectContextView. Guarded by the parent repos/[repoId]/layout.tsx. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
