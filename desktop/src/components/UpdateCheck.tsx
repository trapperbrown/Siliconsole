import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { config } from "../lib/config";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; current: string }
  | { kind: "available"; current: string; latest: string; url: string }
  | { kind: "error"; message: string };

const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
/** True when version `a` is newer than `b` (major.minor.patch). */
export function isNewer(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Asks GitHub for the newest release, only when clicked. Nothing about the user or their PC is sent. */
export function UpdateCheck() {
  const [state, setState] = useState<State>({ kind: "idle" });

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const current = await getVersion();
      const res = await fetch(config.ui.latestReleaseApi, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(res.status === 404 ? "No releases are published yet." : `GitHub answered ${res.status}. Try again later.`);
      const r: { tag_name?: string; html_url?: string } = await res.json();
      if (!r.tag_name || !r.html_url) throw new Error("GitHub sent an unexpected answer. Try again later.");
      setState(isNewer(r.tag_name, current) ? { kind: "available", current, latest: r.tag_name.replace(/^v/, ""), url: r.html_url } : { kind: "latest", current });
    } catch (e) {
      // fetch throws a TypeError when offline or blocked.
      setState({ kind: "error", message: e instanceof TypeError ? "Couldn't reach GitHub. Check your internet connection." : e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button className="btn" onClick={check} disabled={state.kind === "checking"} data-tip="Asks GitHub whether a newer version is out. Only happens when you click; nothing about your PC is sent.">
        {state.kind === "checking" ? "Checking..." : "Check for updates"}
      </button>
      {state.kind === "latest" && <span className="text-success">You have the latest version ({state.current}).</span>}
      {state.kind === "error" && <span className="text-warning">{state.message}</span>}
      {state.kind === "available" && (
        <>
          <span className="text-accent">
            Version {state.latest} is out (you have {state.current}).
          </span>
          <span className="selectable min-w-0 truncate text-muted">{state.url}</span>
          <button className="btn btn-accent" onClick={() => openUrl(state.url)} data-tip="Opens the release page in your browser, where you can download the installer">
            Open download page
          </button>
        </>
      )}
    </div>
  );
}
