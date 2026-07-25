// Pure parser for a git remote URL into its GitHub {host, owner, repo}. Handles
// the scp-like form (git@github.com:owner/repo.git), full URLs
// (https://github.com/owner/repo(.git)), and ssh:// URLs, plus enterprise hosts.
// Returns null when the URL is not a recognizable owner/repo remote.

export interface GitHubRemote {
  host: string;
  owner: string;
  repo: string;
}

function finalize(host: string, owner: string, repo: string): GitHubRemote | null {
  const cleanHost = host.trim().toLowerCase();
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim().replace(/\.git$/i, "");
  if (!cleanHost || !cleanOwner || !cleanRepo) {
    return null;
  }
  return { host: cleanHost, owner: cleanOwner, repo: cleanRepo };
}

export function parseGitHubRemote(remoteUrl: string): GitHubRemote | null {
  const url = (remoteUrl ?? "").trim();
  if (!url) {
    return null;
  }

  // scp-like: [user@]host:owner/repo(.git)
  const scp = /^(?:[A-Za-z0-9._-]+@)?([^:/]+):([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (scp && !url.includes("://")) {
    return finalize(scp[1], scp[2], scp[3]);
  }

  // proto URL: scheme://[user[:pass]@]host[:port]/owner/repo(.git)
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
    if (segments.length < 2) {
      return null;
    }
    return finalize(parsed.hostname, segments[0], segments[1]);
  } catch {
    return null;
  }
}
