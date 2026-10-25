import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Settings } from './Icons';
import useStore from '../../store/useStore';
import { parseGitHubRepoUrl, useHealth } from '../../api';
import { useOpenRepo } from '../../hooks/useOpenRepo';

const Header = () => {
  const [url, setUrl] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const navigate = useNavigate();
  const open = useOpenRepo();
  const openError = useStore((s) => s.openError);
  const setOpenError = useStore((s) => s.setOpenError);
  const health = useHealth();
  const busy = open.isPending;
  const error = inputError ?? openError;

  const handleAnalyze = (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (busy || !url.trim()) return;
    if (!parseGitHubRepoUrl(url)) {
      setInputError('Enter a GitHub repository URL like https://github.com/owner/repo.');
      return;
    }
    setInputError(null);
    open.mutate(url);
  };

  const dismissError = () => {
    setInputError(null);
    setOpenError(null);
  };

  return (
    <>
    <header className="min-h-16 lg:h-18 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-8 lg:px-15 py-2 lg:py-0 z-50">

      {/* LEFT: Brand Name */}
      <div className="flex items-center cursor-pointer group" onClick={() => navigate('/')}>
        <h1 className="font-bold tracking-tighter text-2xl sm:text-4xl text-zinc-100 transition-opacity group-hover:opacity-80">
          Repo<span className="text-brand-primary">Graph</span>
        </h1>
      </div>

      {/* CENTER: Search/URL Input Wrapper */}
      <form className="order-last w-full lg:order-none lg:w-auto lg:flex-1 lg:max-w-4xl lg:mx-8" onSubmit={handleAnalyze}>
        <div className="relative group">
          {/* Search Icon */}
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brand-primary transition-colors"
            size={15}
          />

          {/* The Input Field */}
          <input
            type="text"
            aria-label="GitHub repository URL"
            aria-invalid={!!error}
            placeholder="Enter GitHub Repository URL..."
            disabled={busy}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-full py-1 pl-10 pr-28 text-base
                       text-zinc-200 placeholder-zinc-500 disabled:opacity-60
                       focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50
                       transition-all duration-200"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (inputError) setInputError(null);
            }}
          />

          <button
          type="submit"
          disabled={busy || !url.trim()}
          className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 bg-brand-primary text-zinc-950 text-xs font-bold px-3 py-1 rounded-full hover:bg-brand-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? 'Working…' : 'Analyze'}
        </button>

        </div>
      </form>

      {/* RIGHT: User Actions */}
      <div className="flex items-center gap-4">
        <span
          role="status"
          aria-label={health.isError ? 'Backend offline' : health.isSuccess ? 'Backend online' : 'Checking backend'}
          title={health.isError ? 'Backend offline' : health.isSuccess ? 'Backend online' : 'Checking backend…'}
          className={`w-2.5 h-2.5 rounded-full ${health.isError ? 'bg-red-500' : health.isSuccess ? 'bg-green-500' : 'bg-zinc-600'}`}
        />
        <button className="cursor-pointer border-white p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-all">
          <Settings size={20} />
        </button>
        {/* Profile Avatar Placeholder */}
        <div className="w-8 h-8 rounded-full bg-linear-to-tr from-brand-primary to-brand-secondary border border-zinc-700 cursor-pointer hover:ring-2 ring-brand-primary/50 transition-all" />
      </div>

    </header>
    {error && (
      <div role="alert" className="flex items-center justify-between gap-4 px-4 sm:px-8 lg:px-15 py-2 text-sm bg-red-950/60 border-b border-red-900/60 text-red-200">
        <span>{error}</span>
        <button onClick={dismissError} className="cursor-pointer text-red-300 hover:text-white text-xs font-semibold">
          Dismiss
        </button>
      </div>
    )}
    </>
  );
};

export default Header;
