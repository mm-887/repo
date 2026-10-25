import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { errorMessage, openRepo, parseGitHubRepoUrl, queryKeys } from '../api'
import useStore from '../store/useStore'

export const repoPath = (owner: string, repo: string) =>
  `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

export function useOpenRepo() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (input: string) => {
      const store = useStore.getState()
      const ref = parseGitHubRepoUrl(input)
      store.setOpenError(null)
      store.setOpenStatus({
        phase: 'checking',
        target: ref ? `${ref.owner}/${ref.repo}` : input.trim(),
        startedAt: Date.now(),
      })
      return openRepo(input, { onPhase: (phase) => useStore.getState().setOpenPhase(phase) })
    },
    onSuccess: async (r) => {
      if (r.source !== 'existing') await qc.invalidateQueries({ queryKey: queryKeys.repo(r.owner, r.repo) })
      useStore.getState().addRecentRepo(r.owner, r.repo)
      navigate(repoPath(r.owner, r.repo))
    },
    onError: (e) => useStore.getState().setOpenError(errorMessage(e)),
    onSettled: () => useStore.getState().setOpenStatus(null),
  })
}
