import { expect, test } from "vitest";
import { checkCitations, selectEvidence } from "../chat.js";
import { day, issue, upd } from "./helpers.js";

const now = new Date(day(10));
const kitchen = upd(["r1"], "tiling", day(9), { scopeLabel: "Block A · Floor 2 · Kitchen" });
const bath = upd(["r2"], "plumbing", day(1), { scopeLabel: "Block B · Floor 1 · Bathroom" });
const crack = issue({ scopeLabel: "Block B · Floor 1 · Bathroom", title: "Leaking pipe" });

test("evidence favours records that mention the question's words", () => {
  const ev = selectEvidence("what is happening in the bathroom?", [kitchen, bath], [crack], now, 1);
  expect(ev.updates).toEqual([bath]);
  expect(ev.issues[0]).toBe(crack);
});

test("time words narrow the window", () => {
  expect(selectEvidence("what changed this week", [kitchen, bath], [], now).updates).toEqual([kitchen]);
});

test("citations to records the model never saw are removed", () => {
  const ev = { updates: [kitchen], issues: [crack] };
  const out = checkCitations(`Kitchen is tiling [U${kitchen.id}]. Bath leaks [I${crack.id}] [U999].`, ev);
  expect(out.refs).toEqual([`U${kitchen.id}`, `I${crack.id}`]);
  expect(out.answer).not.toContain("U999");
});

import { chatFacts, offlineAnswer, scopeOf, stageFacts } from "../chat.js";
import { buildRooms } from "../structure.js";
import { withItems } from "../checklist.js";
import { summarise } from "../summary.js";

const apt = withItems(buildRooms({ type: "apartment", site: ["Swimming pool"], blocks: [
  { floors: 3, basement: false, stilt: false, flatTypes: [{ name: "2BHK", perFloor: 2, rooms: ["Kitchen", "Bedroom", "Bedroom", "Toilet"] }], commonRooms: ["Staircase"], outside: [] },
  { floors: 2, basement: false, stilt: false, flatTypes: [{ name: "1BHK", perFloor: 1, rooms: ["Kitchen", "Bedroom"] }], commonRooms: [], outside: [] },
] }));
const ids = (q: string) => scopeOf(q, apt)?.rooms.map((r) => r.id);

test("questions are resolved to the rooms they name", () => {
  expect(scopeOf("how is the site doing?", apt)).toBeNull();
  expect(scopeOf("how far is flat A-102?", apt)!.label).toBe("Block A · Floor 1 · Flat A-102 · 4 rooms");
  expect(scopeOf("and A102 bedroom 2", apt)!.label).toBe("Block A · Floor 1 · Flat A-102 · Bedroom 2");
  expect(scopeOf("kitchens on the 2nd floor of block A", apt)!.label).toBe("Block A · Floor 2 · Kitchens · 2 rooms");
  expect(ids("block b bathrooms")).toEqual([]); // block B has no toilets: say so, never fall back to the whole site
  expect(scopeOf("ground floor toilets in block A", apt)!.rooms).toHaveLength(2); // "toilets" also matches "bathroom" wording
  expect(scopeOf("is the swimming pool started", apt)!.label).toBe("Outside · Swimming pool");
});

test("facts for a scope give exact figures, stages, required items left, and the latest update id", () => {
  const kitchen = apt.find((r) => r.unit === "A-101" && r.name === "Kitchen")!;
  kitchen.items![0].doneAt = day(1);
  const ups = [upd([kitchen.id], "tiling", day(2))];
  const s = summarise(apt, ups);
  const { facts, focus } = chatFacts("what is left in the A-101 kitchen?", apt, s, ups, [], [], new Date(day(3)));
  expect(focus).toEqual(new Set([kitchen.id]));
  expect(facts[0]).toContain("Block A · Floor 1 · Flat A-101 · Kitchen: 48% complete.");
  expect(facts[0]).toContain(`latest [U${ups[0].id}] yesterday`);
  expect(facts[0]).toContain("Required items still to do: 6 of 7");
  // follow-up keeps the place from the question before
  expect(chatFacts("and is it finished?", apt, s, ups, [], [{ q: "what about flat A-101", a: "..." }]).focus.size).toBe(4);
  expect(stageFacts("which rooms are at tiling?", apt, s)).toBe("Rooms at tiling: 1 room: Block A · Floor 1 · Flat A-101 · Kitchen.");
  expect(offlineAnswer(facts, "X", apt, s)).toMatch(/^The AI is not available right now.*48% complete/);
});

test("a photo sent with a question reaches the model, and the prompt says it is there; a model failure falls back to figures", async () => {
  const { answerQuestion } = await import("../chat.js");
  const kitchen = apt.find((r) => r.unit === "A-101" && r.name === "Kitchen")!;
  const ups = [upd([kitchen.id], "tiling", day(2))];
  const seen: { prompt: string; image?: string }[] = [];
  const out = await answerQuestion({ name: "Site", rooms: apt }, ups, [], "Is the tiling in Flat A-101 done right?", [], { image: "QUJD", ask: async (prompt, image) => (seen.push({ prompt, image }), `Tiles look even [U${ups[0].id}].`) });
  expect(seen[0].image).toBe("QUJD");
  expect(seen[0].prompt).toContain("PHOTO: The manager attached a photo");
  expect(out).toMatchObject({ answer: `Tiles look even [U${ups[0].id}].`, refs: [`U${ups[0].id}`], offline: false });
  const plain = await answerQuestion({ name: "Site", rooms: apt }, ups, [], "How far along?", [], { ask: async (prompt) => (seen.push({ prompt }), "x") });
  expect(seen[1].prompt).not.toContain("PHOTO:");
  const down = await answerQuestion({ name: "Site", rooms: apt }, ups, [], "How far along?", [], { ask: async () => Promise.reject(new Error("down")) });
  expect(down.offline).toBe(true);
  expect(plain.offline).toBe(false);
});

test("grouped citations are split, unknown ids and section labels dropped, other brackets left alone", () => {
  const ev = selectEvidence("tiling", [upd(["r1"], "tiling", day(1))], [], new Date());
  const id = `U${ev.updates[0].id}`;
  const out = checkCitations(`Tiling started [KEY FACTS, ${id}, U999]. See [KEY FACTS]. Size [12 x 10].`, ev);
  expect(out.answer).toBe(`Tiling started [${id}]. See. Size [12 x 10].`);
  expect(out.refs).toEqual([id]);
});
