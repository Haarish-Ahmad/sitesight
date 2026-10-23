import { useState } from "react";
import { needsReview, statusOf } from "../../src/summary";
import { plural } from "../lib";
import { Empty, Icon, Segmented } from "../ui";
import { UpdateCard, useProject } from "./common";

type Filter = "review" | "checking" | "checked";

export function Review() {
  const ctx = useProject();
  const [filter, setFilter] = useState<Filter>("review");
  const sorted = [...ctx.data.updates].sort((a, b) => b.at.localeCompare(a.at));
  const lists: Record<Filter, typeof sorted> = {
    review: sorted.filter(needsReview),
    checking: sorted.filter((u) => statusOf(u) === "checking"),
    checked: sorted.filter((u) => u.photos.length && !needsReview(u) && statusOf(u) !== "checking"),
  };
  const shown = lists[filter];
  const count = (id: Filter, label: string) => <>{label} <span className="pill-count">{lists[id].length}</span></>;
  return (
    <div className="review">
      <details className="explain card">
        <summary><Icon name="scan" size={16} /> <b>How the claims check works</b></summary>
        <p>Each photo is compared with the stage that was reported, and checked for re-used, old or off-site photos. Flags are hints for a person to check, not proof. Approving or rejecting a claim settles it: rejected claims stop counting toward progress.</p>
      </details>
      <Segmented label="Show" value={filter} onChange={setFilter} options={[["review", count("review", "To review")], ["checking", count("checking", "Checking")], ["checked", count("checked", "Done")]]} />
      {!shown.length ? (
        filter === "review" ? (
          <Empty icon="check" title="Nothing to review" action={<a className="btn primary" href={ctx.href("upload")}><Icon name="camera" size={16} /> Upload site photos</a>}>
            {lists.checking.length ? `${plural(lists.checking.length, "update")} still with the AI; they appear here if anything looks off.` : "New uploads that look off, and rooms marked finished, show up here."}
          </Empty>
        ) : (
          <Empty icon={filter === "checking" ? "scan" : "flag"} title={filter === "checking" ? "No photos are being checked" : "No checked photos yet"} />
        )
      ) : (
        <div className="stack">{shown.map((u) => <UpdateCard key={u.id} u={u} />)}</div>
      )}
    </div>
  );
}
