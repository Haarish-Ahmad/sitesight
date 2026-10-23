import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { Icon } from "../ui";
import { useProject } from "./common";
import { layout } from "./Overview";

// Printable stickers, one per flat (apartments) or room (houses). Stuck on the door frame, a scan with the
// phone camera opens the upload form already set to that place: no picking block, floor and flat on site.
export function QrSheet() {
  const ctx = useProject();
  const { project } = ctx.data;
  const cells = useMemo(
    () => layout(project.rooms, ctx.apartment).flatMap((sec) => sec.rows.flatMap((row) => row.cells.map((c) => ({ ...c, where: [sec.title, row.label].filter(Boolean).join(" · ") })))),
    [project.rooms, ctx.apartment],
  );
  const base = `${location.origin}${location.pathname}#/p/${project.id}/upload?`;
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const svg = (url: string) => {
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); // only squares: the URL is encoded, not printed
  };
  return (
    <div className="qr-sheet">
      <section className="card no-print">
        <div className="card-head">
          <div>
            <h2><Icon name="qr" /> Room QR stickers</h2>
            <p className="muted small" style={{ margin: 0 }}>Print, cut and stick one on each {ctx.apartment ? "flat's door frame" : "room's door frame"}. The site team scans it with the phone camera and lands on the upload form for that exact place.</p>
          </div>
          <button className="btn primary" onClick={() => print()}><Icon name="printer" size={16} /> Print {cells.length} stickers</button>
        </div>
        {local && (
          <p className="callout warn">
            <Icon name="alert" size={15} />
            <span>These codes point to <b>{location.host}</b>, which a phone cannot open. Open SiteSight on this computer's network address instead (start the web app with <code>npm run web -- --host</code> and use the address it prints), then print again.</span>
          </p>
        )}
      </section>
      <div className="stickers">
        {cells.map((c) => (
          <figure className="sticker" key={c.key}>
            <div className="qr" dangerouslySetInnerHTML={{ __html: svg(base + new URLSearchParams({ b: c.scope.block, f: c.scope.floor, u: c.scope.unit, n: c.scope.name })) }} />
            <figcaption>
              <b>{c.title}</b>
              <span>{c.where}</span>
              <small><Icon name="camera" size={12} /> Scan to add a photo update · {project.name}</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
