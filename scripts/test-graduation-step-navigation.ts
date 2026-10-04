import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as rail from "../src/components/graduation-step-rail";

// Keep the initial regression failure an assertion about the missing behavior,
// rather than a module import error before the assertions can run.
const navigation = rail as typeof rail & {
  GRADUATION_LAST_STEP?: number;
  getNextGraduationStep?: (current: number) => number;
  getGraduationStepFromRail?: (index: number) => number;
};
const nextStep = navigation.getNextGraduationStep;
const stepFromRail = navigation.getGraduationStepFromRail;
assert.ok(
  typeof nextStep === "function",
  "graduation navigation must allow advancing through price summary to final confirmation",
);
assert.ok(
  typeof stepFromRail === "function",
  "rail selections must resolve to the corresponding internal wizard step",
);

// A boundary based on the ten visible labels used to stop at internal step 9.
// Exercise the boundary together with Next so confirmation remains reachable.
let current = 7;
const visited = [current];
for (let attempts = 0; attempts < 4 && current < navigation.GRADUATION_LAST_STEP!; attempts++) {
  current = nextStep(current);
  visited.push(current);
}
assert.deepEqual(
  visited,
  [7, 8, 9, 10],
  "Next must continue through internal step 8, price summary, and final confirmation",
);
for (const [input, expected] of [[0, 1], [7, 8], [8, 9], [9, 10], [10, 10], [-1, 0], [11, 10]]) {
  assert.equal(nextStep(input), expected, `Next from internal step ${input}`);
}

for (const [index, expected] of [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 9], [9, 10]]) {
  assert.equal(stepFromRail(index), expected, `visible rail item ${index} must open internal step ${expected}`);
}

// Existing UI primitives use the project's preserved JSX transform.
Object.assign(globalThis, { React });

type RailButton = React.ReactElement<{
  children?: React.ReactNode;
  onClick?: () => void;
}>;

function collectButtons(node: React.ReactNode): RailButton[] {
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node)) return [];
  if (node.type === "button") return [node];
  return collectButtons(node.props.children);
}

let selectedStep: number | undefined;
const buttons = collectButtons(rail.GraduationStepRail({
  current: 7,
  onStepChange: (step) => { selectedStep = step; },
}));
for (const [label, expected] of [["ملخص السعر", 9], ["التأكيد", 10]] as const) {
  const button = buttons.find((candidate) => candidate.key === label);
  assert.ok(button, `${label} must be selectable in the real rail`);
  assert.ok(button.props.onClick, `${label} must have a click handler`);
  button.props.onClick();
  assert.equal(selectedStep, expected, `clicking ${label} must open internal step ${expected}`);
}

for (const [step, label] of [[9, "ملخص السعر"], [10, "التأكيد"]] as const) {
  const markup = renderToStaticMarkup(React.createElement(rail.GraduationStepRail, {
    current: step,
    onStepChange: () => {},
  }));
  const activeButtons = [...markup.matchAll(/<button\b[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(activeButtons.length, 1, `internal step ${step} must have exactly one active rail item`);
  assert.ok(activeButtons[0][1].includes(label), `internal step ${step} must activate ${label}`);
}

console.log("PASS: graduation Next reaches confirmation, rail clicks open the correct steps, and active labels match.");
