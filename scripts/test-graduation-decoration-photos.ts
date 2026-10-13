import assert from "node:assert/strict";
import {
  GRADUATION_DECORATION_POSITIONS,
  decorationPositionImages,
  selectDecorationPosition,
  setDecorationPositionImage,
} from "../src/lib/graduation-decoration-photos";
import { graduationOrderInputSchema, normalizeGraduationConfig } from "../src/lib/graduation";

assert.ok(GRADUATION_DECORATION_POSITIONS.includes("cap"), "cap is a supported image location");
assert.ok(GRADUATION_DECORATION_POSITIONS.includes("cap_edge"), "cap edge is a supported image location");
assert.ok(GRADUATION_DECORATION_POSITIONS.includes("sleeve"), "older sleeve references remain readable");

const legacy = { type: "printing", position: "front" as const, file: "legacy-front", fileName: "front.png" };
assert.equal(decorationPositionImages(legacy).front?.file, "legacy-front");

const backSelected = selectDecorationPosition(legacy, "back");
assert.equal(backSelected.file, "");
assert.equal(decorationPositionImages(backSelected).front?.file, "legacy-front");

const backUploaded = setDecorationPositionImage(backSelected, "back", { file: "back-image", fileName: "back.png" });
const sashUploaded = setDecorationPositionImage(backUploaded, "sash", { file: "sash-image", fileName: "sash.png" });
const capUploaded = setDecorationPositionImage(sashUploaded, "cap", { file: "cap-image", fileName: "cap.png" });
const capEdgeUploaded = setDecorationPositionImage(capUploaded, "cap_edge", { file: "edge-image", fileName: "edge.png" });
assert.equal(sashUploaded.file, "back-image", "a separate sash upload must not change the selected back image");
assert.equal(decorationPositionImages(sashUploaded).back?.file, "back-image");
assert.equal(decorationPositionImages(sashUploaded).sash?.file, "sash-image");
assert.equal(decorationPositionImages(capEdgeUploaded).cap?.file, "cap-image");
assert.equal(decorationPositionImages(capEdgeUploaded).cap_edge?.file, "edge-image");
assert.equal(decorationPositionImages(capEdgeUploaded).back?.file, "back-image");

const edgeSelected = selectDecorationPosition(capEdgeUploaded, "cap_edge");
assert.equal(edgeSelected.file, "edge-image");
const capRemoved = setDecorationPositionImage(edgeSelected, "cap", null);
assert.equal(decorationPositionImages(capRemoved).cap, undefined);
assert.equal(decorationPositionImages(capRemoved).cap_edge?.file, "edge-image");

const sashSelected = selectDecorationPosition(sashUploaded, "sash");
assert.equal(sashSelected.file, "sash-image");
assert.equal(decorationPositionImages(sashSelected).back?.file, "back-image");

const backRemoved = setDecorationPositionImage(sashSelected, "back", null);
assert.equal(decorationPositionImages(backRemoved).back, undefined);
assert.equal(decorationPositionImages(backRemoved).sash?.file, "sash-image");
assert.equal(decorationPositionImages(backRemoved).front?.file, "legacy-front");

const decorationSchema = graduationOrderInputSchema.shape.decoration;
assert.equal(decorationSchema.safeParse({
  type: "printing", position: "back",
  positionFiles: {
    back: { file: "back-image", fileName: "back.png" },
    sash: { file: "sash-image", fileName: "sash.png" },
    cap: { file: "cap-image", fileName: "cap.png" },
    cap_edge: { file: "edge-image", fileName: "edge.png" },
  },
}).success, true);
assert.equal(decorationSchema.safeParse({
  type: "embroidery", position: "cap_edge", positionFiles: {
    cap_edge: { file: "edge-image", fileName: "edge.png" },
  },
}).success, true);
assert.equal(decorationSchema.safeParse({ type: "printing", position: "sleeve" }).success, true,
  "historical sleeve orders must remain valid");
assert.equal(decorationSchema.safeParse({
  type: "printing", position: "back", positionFiles: { unknown: { file: "wrong", fileName: "x.png" } },
}).success, false, "unknown positions may not be submitted");
assert.equal(decorationSchema.safeParse({
  type: "printing", position: "back", positionFiles: { back: { file: "", fileName: "x.png" } },
}).success, false, "an empty upload must not become a design document");

const legacyPrices = normalizeGraduationConfig({
  printingPrices: { sleeve: 5000 }, embroideryPrices: { sleeve: 7000 },
});
assert.equal(legacyPrices.printingPrices.cap, 5000, "renamed cap pricing inherits the prior sleeve price");
assert.equal(legacyPrices.embroideryPrices.cap, 7000, "renamed cap embroidery inherits the prior sleeve price");
assert.equal(legacyPrices.printingPrices.cap_edge, 0, "new cap edge has its own starting price");
assert.equal(normalizeGraduationConfig({ printingPrices: { sleeve: 5000, cap: 3000 } }).printingPrices.cap, 3000,
  "an explicitly configured cap price takes priority");

console.log("PASS location images stay independent; legacy image survives; the order schema validates each location");
