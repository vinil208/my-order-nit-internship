import { parentPort, workerData } from "node:worker_threads";
import { Factory } from "../domain.js";
const f = new Factory(workerData.path);
parentPort.postMessage({ ready: true });
Atomics.wait(new Int32Array(workerData.gate), 0, 0, 5000);
try {
  f.act(
    f.get("SELECT * FROM users WHERE id=1"),
    "approve",
    { id: workerData.id },
    "race-" + workerData.id,
  );
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
} finally {
  f.db.close();
}
