import { useRef, useState } from "react";
import type { Doc } from "../../src/types";
import { api, fmtDateTime, fmtSize, upload } from "../lib";
import { Empty, Icon, Progress, useFeedback } from "../ui";
import { useProject } from "./common";

const CATEGORIES: { id: Doc["category"]; label: string }[] = [
  { id: "plans", label: "Plans & drawings" },
  { id: "permits", label: "Permits" },
  { id: "contracts", label: "Contracts" },
  { id: "reports", label: "Reports" },
  { id: "other", label: "Other" },
];

export function Documents() {
  const ctx = useProject();
  const { toast, confirm } = useFeedback();
  const [category, setCategory] = useState<Doc["category"]>("plans");
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const docs = ctx.data.documents;

  async function send(list: FileList | null) {
    for (const f of [...(list ?? [])]) {
      if (f.size > 25e6) {
        toast(`${f.name} is over 25 MB`, "error");
        continue;
      }
      const fd = new FormData();
      fd.set("file", f);
      fd.set("category", category);
      setProgress(0);
      try {
        await upload(`${ctx.base}/documents`, fd, setProgress);
        toast(`${f.name} uploaded`);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    }
    setProgress(null);
    await ctx.reload();
  }
  async function remove(d: Doc) {
    if (!(await confirm({ title: "Delete this document?", body: <><b>{d.title}</b> will be removed for everyone, including anyone with the share link.</>, confirm: "Delete", danger: true }))) return;
    try {
      await api(`${ctx.base}/documents/${d.id}`, { method: "DELETE" });
      toast("Document deleted");
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="documents">
      {!ctx.readOnly && (
        <section className="card">
          <div className="two">
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as Doc["category"])}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <div
              className={`drop small ${drag ? "over" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => (e.preventDefault(), setDrag(false), send(e.dataTransfer.files))}
            >
              <Icon name="upload" /> <b>Add documents</b> <span className="muted small">PDF, drawings, spreadsheets… up to 25 MB each</span>
              <input ref={input} type="file" multiple hidden onChange={(e) => (send(e.target.files), (e.target.value = ""))} />
            </div>
          </div>
          {progress !== null && <Progress value={progress * 100} label="Upload progress" />}
        </section>
      )}
      {!docs.length ? (
        <Empty icon="folder" title="No documents yet" action={!ctx.readOnly && <button className="btn primary" onClick={() => input.current?.click()}><Icon name="plus" size={16} /> Add the first document</button>}>{ctx.readOnly ? "The site team has not shared any documents." : "Keep plans, permits and contracts next to the progress, so everyone works from the same papers."}</Empty>
      ) : (
        CATEGORIES.filter((c) => docs.some((d) => d.category === c.id)).map((c) => (
          <section key={c.id} className="card">
            <h2>{c.label}</h2>
            <ul className="doc-list">
              {docs.filter((d) => d.category === c.id).sort((a, b) => b.at.localeCompare(a.at)).map((d) => (
                <li key={d.id}>
                  <Icon name="file" size={20} />
                  <div>
                    <a href={`${ctx.base}/documents/${d.id}/file`} target="_blank" rel="noreferrer"><b>{d.title}</b></a>
                    <p className="muted small">{fmtSize(d.size)} · added {fmtDateTime(d.at)}</p>
                  </div>
                  <a className="icon-btn" href={`${ctx.base}/documents/${d.id}/file`} download aria-label={`Download ${d.title}`}><Icon name="download" size={16} /></a>
                  {!ctx.readOnly && <button className="icon-btn" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}><Icon name="trash" size={16} /></button>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
