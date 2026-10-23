import { useState } from "react";
import { ago } from "../../src/describe";
import type { Issue } from "../../src/types";
import { api, buzz, fmtDateTime } from "../lib";
import { Empty, Icon, Segmented, useFeedback } from "../ui";
import { IssueForm, updatePhotos, useProject } from "./common";

type Filter = "open" | "suggested" | "resolved";
const RANK = { high: 0, medium: 1, low: 2 };

export function Issues() {
  const ctx = useProject();
  const { toast } = useFeedback();
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState(false);
  const all = ctx.data.issues;
  const lists: Record<Filter, Issue[]> = {
    open: all.filter((i) => i.status === "open").sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.at.localeCompare(a.at)),
    suggested: all.filter((i) => i.status === "suggested").sort((a, b) => b.at.localeCompare(a.at)),
    resolved: all.filter((i) => i.status === "resolved").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
  };
  const filters: [Filter, string][] = ctx.readOnly ? [["open", "Open"], ["resolved", "Resolved"]] : [["open", "Open"], ["suggested", "Suggested by AI"], ["resolved", "Resolved"]];

  async function setStatus(i: Issue, status: Issue["status"], msg: string) {
    buzz();
    try {
      await api(`${ctx.base}/issues/${i.id}`, { method: "PATCH", json: { status } });
      toast(msg, "ok", status === "resolved" ? () => void setStatus(i, "open", "Issue reopened") : undefined);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const evidence = (i: Issue) => {
    const u = ctx.data.updates.find((x) => x.id === i.updateId);
    if (!u) return;
    const photos = updatePhotos(ctx, u);
    ctx.showPhotos(photos, Math.max(0, u.photos.findIndex((p) => p.file === i.photo)));
  };

  return (
    <div className="issues">
      <div className="toolbar-row">
        <Segmented label="Show" value={filter} onChange={setFilter} options={filters.map(([id, label]) => [id, <>{label} <span className="pill-count">{lists[id].length}</span></>] as const)} />
        {!ctx.readOnly && (
          <div className="dock">
            <button className="btn primary big" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Report an issue</button>
          </div>
        )}
      </div>
      {filter === "suggested" && lists.suggested.length > 0 && <p className="muted small">The AI noticed these in photos. Confirm the real ones; dismiss the rest.</p>}
      {!lists[filter].length ? (
        <Empty
          icon={filter === "resolved" ? "check" : "alert"}
          title={filter === "open" ? "No open issues" : filter === "suggested" ? "No AI suggestions" : "Nothing resolved yet"}
          action={filter === "open" && !ctx.readOnly && <button className="btn ghost" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Report the first issue</button>}
        >
          {filter === "open" && !ctx.readOnly ? "Report problems you find on site, or confirm ones the AI spots in photos." : undefined}
        </Empty>
      ) : (
        <div className="stack">
          {lists[filter].map((i) => (
            <article key={i.id} className={`card issue sev-border-${i.severity}`} id={`I${i.id}`}>
              <div className="issue-main">
                {i.photo && i.updateId !== null && (
                  <button className="thumb" onClick={() => evidence(i)} aria-label="Open evidence photo">
                    <img src={ctx.photo(i.photo, 240)} alt="" loading="lazy" />
                  </button>
                )}
                <div>
                  <h3>{i.title}</h3>
                  <p className="muted small">
                    <span className={`sev sev-${i.severity}`}>{i.severity}</span> · {i.scopeLabel} · #{i.id} · {i.source === "ai" ? "spotted by AI" : "reported"} {ago(i.at)}
                    {i.resolvedAt && ` · resolved ${fmtDateTime(i.resolvedAt)}`}
                  </p>
                  {i.note && <p>{i.note}</p>}
                </div>
              </div>
              {!ctx.readOnly && (
                <footer className="update-actions">
                  {i.status === "suggested" && (
                    <>
                      <button className="btn primary small" onClick={() => setStatus(i, "open", "Issue confirmed")}><Icon name="check" size={15} /> Confirm</button>
                      <button className="btn ghost small" onClick={() => setStatus(i, "dismissed", "Suggestion dismissed")}><Icon name="x" size={15} /> Dismiss</button>
                    </>
                  )}
                  {i.status === "open" && <button className="btn ghost small" onClick={() => setStatus(i, "resolved", "Marked resolved")}><Icon name="check" size={15} /> Mark resolved</button>}
                  {i.status === "resolved" && <button className="btn ghost small" onClick={() => setStatus(i, "open", "Issue reopened")}>Reopen</button>}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
      {adding && <IssueForm onClose={() => setAdding(false)} />}
    </div>
  );
}
