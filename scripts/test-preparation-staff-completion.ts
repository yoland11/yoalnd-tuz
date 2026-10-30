import assert from "node:assert/strict";
import { completeStandalonePreparationTask } from "../src/server/preparation-requests";
import type { PreparationCompletionRepository } from "../src/server/preparation-requests";

type State = { taskStatus: string; itemStatus: string; assignment: number[]; requestActive: boolean };
function repository(state: State, failTaskWrite = false): PreparationCompletionRepository {
  return {
    transaction: async (run) => {
      const staged = { ...state, assignment: [...state.assignment] };
      const result = await run({
        taskForUpdate: async () => ({ id: 9, taskType: "preparation", relatedType: "preparation_request", relatedId: 3, assignedStaffIds: staged.assignment, status: staged.taskStatus }),
        activeRequest: async () => staged.requestActive,
        itemForTask: async () => ({ id: 7, status: staged.itemStatus }),
        completeItem: async () => { staged.itemStatus = "completed"; },
        completeTask: async () => { if (failTaskWrite) throw new Error("task write failed"); staged.taskStatus = "completed"; },
      });
      Object.assign(state, staged);
      return result;
    },
  };
}

const state: State = { taskStatus: "new", itemStatus: "preparing", assignment: [12], requestActive: true };
const done = await completeStandalonePreparationTask(9, 12, false, repository(state));
assert.deepEqual({ requestId: done.requestId, itemId: done.itemId, taskStatus: state.taskStatus, itemStatus: state.itemStatus }, { requestId: 3, itemId: 7, taskStatus: "completed", itemStatus: "completed" });
await completeStandalonePreparationTask(9, 12, false, repository(state));
assert.equal(state.itemStatus, "completed", "retries stay completed");

const foreign: State = { taskStatus: "new", itemStatus: "preparing", assignment: [12], requestActive: true };
await assert.rejects(() => completeStandalonePreparationTask(9, 13, false, repository(foreign)), /مسندة/);
assert.equal(foreign.taskStatus, "new");

const broken: State = { taskStatus: "new", itemStatus: "preparing", assignment: [12], requestActive: true };
await assert.rejects(() => completeStandalonePreparationTask(9, 12, false, repository(broken, true)), /task write failed/);
assert.equal(broken.itemStatus, "preparing", "the item rolls back if task completion fails");

const archived: State = { taskStatus: "new", itemStatus: "preparing", assignment: [12], requestActive: false };
await assert.rejects(() => completeStandalonePreparationTask(9, 12, false, repository(archived)), /غير موجود/);

console.log("PASS standalone preparation staff completion is assigned, atomic, and retry-safe");
