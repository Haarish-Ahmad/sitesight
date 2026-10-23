import { useState } from "react";
import { buildBlockRooms, describeRooms, EXTRA_PRESETS, floorLabel, nextBlockName, ROOM_PRESETS, scopeLabel, type BlockSpec, type NewRoom } from "../../src/structure";
import { BlockEditor, DEFAULT_BLOCK, normaliseBlock } from "../BlockEditor";
import { api, plural } from "../lib";
import { ALL, ChipEditor, Icon, matchScope, Modal, NumberField, ScopePicker, useFeedback, type Scope } from "../ui";
import { useProject } from "./common";

type Place = Omit<NewRoom, "name">;
const placeKey = (p: Place) => `${p.block}|${p.floor}|${p.unit}`;

// "Rooms & layout" in Settings: the room list can change after the project is created.
export function Layout() {
  const ctx = useProject();
  const { toast, confirm } = useFeedback();
  const rooms = ctx.data.project.rooms;
  const [modal, setModal] = useState<"block" | "rooms" | "remove" | null>(null);

  async function add(fresh: NewRoom[], msg: string) {
    const groups = new Map<string, { place: Place; names: string[] }>();
    for (const r of fresh) {
      const place = { block: r.block, floor: r.floor, unit: r.unit };
      const g = groups.get(placeKey(place)) ?? { place, names: [] };
      g.names.push(r.name);
      groups.set(placeKey(place), g);
    }
    try {
      await api(`${ctx.base}/rooms`, { method: "POST", json: { groups: [...groups.values()] } });
      toast(msg);
      setModal(null);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function remove(ids: string[], label: string) {
    const touched = ctx.data.updates.filter((u) => u.roomIds.some((id) => ids.includes(id))).length;
    const ok = await confirm({
      title: `Remove ${plural(ids.length, "room")}?`,
      body: <>
        <b>{label}</b> will be removed from the project and from progress.
        {touched > 0 && <> {plural(touched, "update")} mention{touched === 1 ? "s" : ""} these rooms: they stay in the timeline as history but no longer count.</>}
        {" "}This cannot be undone.
      </>,
      confirm: `Remove ${plural(ids.length, "room")}`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`${ctx.base}/rooms/remove`, { method: "POST", json: { roomIds: ids } });
      toast(`${plural(ids.length, "room")} removed`);
      setModal(null);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <section className="card">
      <h2><Icon name="grid" /> Rooms and layout</h2>
      <p className="muted">{describeRooms(ctx.data.project.spec.type, rooms)}. Add what was missed (a pool, a new block, a store room) or remove what does not exist.</p>
      <div className="row-actions">
        {ctx.apartment && <button className="btn ghost" onClick={() => setModal("block")}><Icon name="building" size={16} /> Add a block</button>}
        <button className="btn ghost" onClick={() => setModal("rooms")}><Icon name="plus" size={16} /> Add rooms or areas</button>
        <button className="btn ghost danger-text" onClick={() => setModal("remove")}><Icon name="trash" size={16} /> Remove rooms</button>
      </div>
      {modal === "block" && <AddBlock onClose={() => setModal(null)} onAdd={add} />}
      {modal === "rooms" && <AddRooms onClose={() => setModal(null)} onAdd={add} />}
      {modal === "remove" && <RemoveRooms onClose={() => setModal(null)} onRemove={remove} />}
    </section>
  );
}

function AddBlock({ onClose, onAdd }: { onClose: () => void; onAdd: (r: NewRoom[], msg: string) => void }) {
  const ctx = useProject();
  const spec = ctx.data.project.spec;
  // start from the last block's layout when the project still has it, else the default
  const start = spec.type === "apartment" && Array.isArray(spec.blocks) && spec.blocks.length ? normaliseBlock(spec.blocks[spec.blocks.length - 1]) : DEFAULT_BLOCK;
  const [b, setB] = useState<BlockSpec>(structuredClone(start));
  const name = nextBlockName(ctx.data.project.rooms);
  const fresh = buildBlockRooms(b, name);
  return (
    <Modal title={`Add Block ${name}`} onClose={onClose} wide>
      <BlockEditor value={b} onChange={setB} />
      <div className="row-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!b.flatTypes.every((t) => t.rooms.length)} onClick={() => onAdd(fresh, `Block ${name} added with ${plural(fresh.length, "room")}`)}>Add Block {name} ({plural(fresh.length, "room")})</button>
      </div>
    </Modal>
  );
}

function AddRooms({ onClose, onAdd }: { onClose: () => void; onAdd: (r: NewRoom[], msg: string) => void }) {
  const ctx = useProject();
  const rooms = ctx.data.project.rooms;
  const blocks = [...new Set(rooms.map((r) => r.block).filter((b): b is string => !!b))];
  const [block, setBlock] = useState<string>(ctx.apartment ? "site" : "");
  const inBlock = rooms.filter((r) => (ctx.apartment ? r.block === (block === "site" ? null : block) : true));
  const floors = [...new Set(inBlock.map((r) => r.floor).filter((f): f is number => f !== null))].sort((a, b) => a - b);
  const [floor, setFloor] = useState<string>("out"); // "out" | "<n>" | "new"
  const [newFloor, setNewFloor] = useState(Math.max(-1, ...floors) + 1);
  const units = [...new Set(inBlock.filter((r) => String(r.floor) === floor).map((r) => r.unit).filter((u): u is string => !!u))];
  const [unit, setUnit] = useState<string>("shared");
  const [names, setNames] = useState<string[]>([]);

  const site = ctx.apartment && block === "site";
  const place: Place = {
    block: ctx.apartment && !site ? block : null,
    floor: site || floor === "out" ? null : floor === "new" ? newFloor : Number(floor),
    unit: !site && floor !== "out" && floor !== "new" && unit !== "shared" ? unit : null,
  };
  const where = site ? "Site-wide areas" : [place.block && `Block ${place.block}`, floorLabel(place.floor), place.unit ? `Flat ${place.unit}` : ctx.apartment && place.floor !== null ? "shared spaces" : null].filter(Boolean).join(" · ");
  const presets = place.floor === null ? EXTRA_PRESETS : place.unit ? ROOM_PRESETS : [...ROOM_PRESETS.filter((r) => !["Exterior", "Roof"].includes(r))];

  return (
    <Modal title="Add rooms or areas" onClose={onClose}>
      <div className="stack">
        <div className="scope-grid">
          {ctx.apartment && (
            <label className="field">
              <span>Where</span>
              <select value={block} onChange={(e) => (setBlock(e.target.value), setFloor("out"), setUnit("shared"))}>
                <option value="site">Site-wide (no block)</option>
                {blocks.map((b) => <option key={b} value={b}>Block {b}</option>)}
              </select>
            </label>
          )}
          {!site && (
            <label className="field">
              <span>Floor</span>
              <select value={floor} onChange={(e) => (setFloor(e.target.value), setUnit("shared"))}>
                <option value="out">{ctx.apartment ? "Outside this block" : "Outside / extra areas"}</option>
                {floors.map((f) => <option key={f} value={String(f)}>{floorLabel(f)}</option>)}
                {!ctx.apartment && <option value="new">A new floor…</option>}
              </select>
            </label>
          )}
          {floor === "new" && <NumberField label="Floor number (0 = ground, -1 = basement)" value={newFloor} min={-1} max={100} onChange={setNewFloor} />}
          {ctx.apartment && !site && floor !== "out" && (
            <label className="field">
              <span>Flat</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="shared">Shared spaces on this floor</option>
                {units.map((u) => <option key={u} value={u}>Flat {u}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="scope-result"><Icon name="pin" size={15} /> <span>Adding to <b>{where}</b></span></p>
        <ChipEditor label="Names" values={names} onChange={setNames} max={30} suggestions={presets} />
        <div className="row-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!names.length} onClick={() => onAdd(names.map((name) => ({ ...place, name })), `${plural(names.length, "room")} added to ${where}`)}>
            Add {plural(names.length, "room")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RemoveRooms({ onClose, onRemove }: { onClose: () => void; onRemove: (ids: string[], label: string) => void }) {
  const ctx = useProject();
  const rooms = ctx.data.project.rooms;
  const [scope, setScope] = useState<Scope>(ALL);
  const picked = matchScope(rooms, scope);
  const all = picked.length === rooms.length;
  return (
    <Modal title="Remove rooms" onClose={onClose}>
      <div className="stack">
        <p className="muted">Pick a room, or a whole flat, floor or block. You confirm on the next step.</p>
        <ScopePicker rooms={rooms} value={scope} onChange={setScope} apartment={ctx.apartment} />
        {all && <p className="callout warn"><Icon name="alert" size={15} /> Narrow it down: a project needs at least one room.</p>}
        <div className="row-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger" disabled={!picked.length || all} onClick={() => onRemove(picked.map((r) => r.id), scopeLabel(picked))}>
            <Icon name="trash" size={16} /> Remove {plural(picked.length, "room")}…
          </button>
        </div>
      </div>
    </Modal>
  );
}

