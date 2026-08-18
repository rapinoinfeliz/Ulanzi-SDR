import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const source = "controller/ulanzi-plugin";
const destination = "artifacts/com.ulanzi.sdrcontrol.ulanziPlugin";
await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
for (const item of ["manifest.json", "pt_PT.json", "dist", "assets", "property-inspector"]) {
  await cp(path.join(source, item), path.join(destination, item), { recursive: true });
}
console.log(destination);
