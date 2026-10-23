import { countBlock, flatCount, type BlockSpec, type FlatType } from "../src/structure";
import { plural } from "./lib";
import { ChipEditor, Icon, NumberField } from "./ui";

export const DEFAULT_BLOCK: BlockSpec = {
  floors: 5, basement: false, stilt: false,
  flatTypes: [{ name: "2BHK", perFloor: 4, rooms: ["Living room", "Kitchen", "Bedroom", "Bedroom", "Toilet", "Toilet", "Balcony"] }],
  commonRooms: ["Staircase", "Lift", "Corridor"], outside: ["Exterior", "Terrace"],
};
const NEW_TYPE: FlatType = { name: "3BHK", perFloor: 1, rooms: ["Living room", "Kitchen", "Bedroom", "Bedroom", "Bedroom", "Toilet", "Toilet", "Balcony"] };

// Specs saved before flat types existed had one layout for every flat.
type OldBlock = Partial<BlockSpec> & { flatsPerFloor?: number; flatRooms?: string[] };
export function normaliseBlock(b: OldBlock): BlockSpec {
  return {
    ...DEFAULT_BLOCK,
    ...b,
    stilt: b.stilt ?? false,
    flatTypes: b.flatTypes ?? [{ name: "Flat", perFloor: b.flatsPerFloor ?? 1, rooms: b.flatRooms ?? DEFAULT_BLOCK.flatTypes[0].rooms }],
  } as BlockSpec;
}

// One block's layout. Used by the setup wizard and by "Add a block" in Settings.
export function BlockEditor({ value, onChange }: { value: BlockSpec; onChange: (b: BlockSpec) => void }) {
  const set = (patch: Partial<BlockSpec>) => onChange({ ...value, ...patch });
  const setType = (i: number, patch: Partial<FlatType>) => set({ flatTypes: value.flatTypes.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <div className="stack">
      <div className="three">
        <NumberField label="Floors (incl. ground)" value={value.floors} min={1} max={80} onChange={(floors) => set({ floors })} />
        <label className="toggle">
          <input type="checkbox" checked={value.stilt} onChange={(e) => set({ stilt: e.target.checked })} /> Stilt parking on ground
        </label>
        <label className="toggle">
          <input type="checkbox" checked={value.basement} onChange={(e) => set({ basement: e.target.checked })} /> Basement
        </label>
      </div>
      {value.flatTypes.map((t, i) => (
        <div className="flat-type" key={i}>
          <div className="stack">
            <div className="row-actions">
              <label className="field" style={{ flex: 1 }}>
                <span>Flat type</span>
                <input value={t.name} maxLength={30} onChange={(e) => setType(i, { name: e.target.value })} placeholder="e.g. 2BHK" />
              </label>
              {value.flatTypes.length > 1 && (
                <button type="button" className="icon-btn" style={{ alignSelf: "end" }} aria-label={`Remove flat type ${t.name}`} onClick={() => set({ flatTypes: value.flatTypes.filter((_, j) => j !== i) })}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
            <ChipEditor label={`Rooms in each ${t.name || "flat"}`} values={t.rooms} onChange={(rooms) => setType(i, { rooms })} />
          </div>
          <NumberField label="Per floor" value={t.perFloor} min={1} max={30} onChange={(perFloor) => setType(i, { perFloor })} />
        </div>
      ))}
      {value.flatTypes.length < 6 && (
        <button type="button" className="btn ghost small" style={{ justifySelf: "start" }} onClick={() => set({ flatTypes: [...value.flatTypes, { ...NEW_TYPE }] })}>
          <Icon name="plus" size={14} /> Add another flat type
        </button>
      )}
      <ChipEditor label="Shared spaces on each floor" values={value.commonRooms} onChange={(commonRooms) => set({ commonRooms })} max={10} />
      <ChipEditor label="Outside this block" values={value.outside} onChange={(outside) => set({ outside })} max={10} />
      <p className="muted small">{plural(flatCount(value), "flat")} · {plural(countBlock(value), "room")} in this block{value.stilt ? " · flats start on floor 1" : ""}</p>
    </div>
  );
}
