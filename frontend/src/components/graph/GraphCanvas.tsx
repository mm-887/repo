import { lazy, Suspense, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useGraph, isApiError, errorMessage } from '../../api';
import useStore from '../../store/useStore';
import { useOpenRepo } from '../../hooks/useOpenRepo';
import { LoadingState, MessageCard, PrimaryButton, ProgressCard, WelcomeState } from '../common/CanvasStates';

const SigmaGraph = lazy(() => import('./SigmaGraph'));

const GraphCanvas = () => {
  const { owner, repo } = useParams();
  const openStatus = useStore((s) => s.openStatus);
  const graph = useGraph(owner, repo);
  const open = useOpenRepo();
  const addRecentRepo = useStore((s) => s.addRecentRepo);

  const loaded = graph.isSuccess;
  useEffect(() => {
    if (loaded && owner && repo) addRecentRepo(owner, repo);
  }, [loaded, owner, repo, addRecentRepo]);

  if (openStatus) return <ProgressCard status={openStatus} />;
  if (!owner || !repo) return <WelcomeState />;
  if (graph.isPending) return (
    <LoadingState
      label="Loading graph…"
      slowHint="Large repositories produce big graphs; this can take a few seconds."
    />
  );

  if (graph.isError) {
    if (isApiError(graph.error) && graph.error.kind === 'not_found') {
      return (
        <MessageCard
          title="Not analyzed yet"
          action={
            <PrimaryButton onClick={() => open.mutate(`https://github.com/${owner}/${repo}`)}>
              Clone &amp; analyze {owner}/{repo}
            </PrimaryButton>
          }
        >
          {owner}/{repo} hasn&apos;t been cloned and indexed by this backend.
        </MessageCard>
      );
    }
    return (
      <MessageCard
        tone="error"
        title="Couldn't load the graph"
        action={<PrimaryButton onClick={() => graph.refetch()}>Try again</PrimaryButton>}
      >
        {errorMessage(graph.error)}
      </MessageCard>
    );
  }

  if (graph.data.nodes.length === 0) {
    return (
      <MessageCard title="Nothing to show">
        {owner}/{repo} was indexed but no Python functions, classes or modules were found.
      </MessageCard>
    );
  }

  return (
    <Suspense fallback={<LoadingState label="Preparing graph…" />}>
      <SigmaGraph key={`${owner}/${repo}`} data={graph.data} owner={owner} repo={repo} />
    </Suspense>
  );
};

export default GraphCanvas;
