import assert from "node:assert/strict";
import {
  decorationPositionImages,
  selectDecorationPosition,
  setDecorationPositionImage,
} from "../src/lib/graduation-decoration-photos";
import { graduationOrderInputSchema } from "../src/lib/graduation";

const legacy = { type: "printing", position: "front" as const, file: "legacy-front", fileName: "front.png" };
assert.equal(decorationPositionImages(legacy).front?.file, "legacy-front");

const backSelected = selectDecorationPosition(legacy, "back");
assert.equal(backSelected.file, "");
assert.equal(decorationPositionImages(backSelected).front?.file, "legacy-front");

const backUploaded = setDecorationPositionImage(backSelected, "back", { file: "back-image", fileName: "back.png" });
const sashUploaded = setDecorationPositionImage(backUploaded, "sash", { file: "sash-image", fileName: "sash.png" });
assert.equal(sashUploaded.file, "back-image", "a separate sash upload must not change the selected back image");
assert.equal(decorationPositionImages(sashUploaded).back?.file, "back-image");
assert.equal(decorationPositionImages(sashUploaded).sash?.file, "sash-image");

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
  },
}).success, true);
assert.equal(decorationSchema.safeParse({
  type: "printing", position: "back", positionFiles: { unknown: { file: "wrong", fileName: "x.png" } },
}).success, false, "only the four supported positions may be submitted");
assert.equal(decorationSchema.safeParse({
  type: "printing", position: "back", positionFiles: { back: { file: "", fileName: "x.png" } },
}).success, false, "an empty upload must not become a design document");

console.log("PASS location images stay independent; legacy image survives; the order schema validates each location");
