import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repositoryRoot, "profiles/station-complete/profile.json");
const iconRoot = path.join(repositoryRoot, "controller/ulanzi-plugin/assets/oled");
const profile = JSON.parse(await readFile(sourcePath, "utf8"));
const versionHeader = strToU8("#Version: 2\n");

for (const device of profile.devices) {
  const packageId = stableUuid(`station-complete:${device.id}:package`);
  const pageId = stableUuid(`station-complete:${device.id}:page`);
  const packageFolder = `${packageId}.ulanziProfile`;
  const pageFolder = `${packageFolder}/Profiles/${pageId}`;
  const files = {};

  const keypad = buildActions(device, "Keypad", device.keypad);
  const encoder = buildActions(device, "Encoder", device.encoder);
  const icons = new Set([
    "plugin",
    ...Object.values(device.keypad).map((item) => item.icon),
    ...Object.values(device.encoder).map((item) => item.icon)
  ]);

  for (const icon of icons) {
    const filename = `${iconSlug(icon)}-normal.svg`;
    files[`${pageFolder}/Images/${filename}`] = new Uint8Array(await readFile(path.join(iconRoot, filename)));
  }
  files[`${packageFolder}/icon.png`] = new Uint8Array(await readFile(path.join(repositoryRoot, "profiles/station-complete/icon.png")));
  files[`${pageFolder}/manifest.json`] = jsonBytes({
    Controllers: [
      { Actions: keypad, Type: "Keypad" },
      { Actions: encoder, Type: "Encoder" }
    ],
    Icon: "",
    Name: profile.name
  });
  files[`${packageFolder}/manifest.json`] = jsonBytes({
    Device: {
      Model: device.model,
      UUID: deviceIdentifier(device.id)
    },
    Icon: "icon.png",
    Name: device.name,
    Pages: {
      Current: pageId,
      Pages: [pageId]
    },
    Version: `${profile.formatVersion}.0`
  });
  files[`${packageFolder}/profile-info.json`] = jsonBytes({
    name: device.name,
    plugin: "com.ulanzi.ulanzistudio.sdrcontrol",
    pluginVersion: profile.pluginVersion,
    generatedFrom: "profiles/station-complete/profile.json"
  });

  const archive = zipSync(files, { level: 9 });
  const output = new Uint8Array(versionHeader.length + archive.length);
  output.set(versionHeader);
  output.set(archive, versionHeader.length);
  const outputPath = path.join(repositoryRoot, "profiles/station-complete", device.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log(`${device.name}: ${path.relative(repositoryRoot, outputPath)} (${output.length} bytes)`);
}

function buildActions(device, controller, slots) {
  return Object.fromEntries(Object.entries(slots).map(([slot, definition]) => {
    const actionId = stableUuid(`station-complete:${device.id}:${controller}:${slot}`);
    const fixedKind = definition.kind;
    const action = fixedKind
      ? `com.ulanzi.ulanzistudio.sdrcontrol.${fixedKind}`
      : "com.ulanzi.ulanzistudio.sdrcontrol.configurable";
    const actionParam = fixedKind ? {} : {
      kind: "configurable",
      mapping: {
        title: definition.title,
        rotate: definition.rotate ?? null,
        press: definition.press ?? null,
        holdRotate: definition.holdRotate ?? null
      }
    };
    const icon = `Images/${iconSlug(definition.icon)}-normal.svg`;
    return [slot, {
      Action: action,
      ActionID: actionId,
      ActionParam: actionParam,
      LinkedTitle: true,
      Name: `SDR ${definition.title}`,
      State: 0,
      ViewParam: [{ Icon: icon, IconEx: icon, Text: definition.title }]
    }];
  }));
}

function jsonBytes(value) {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function stableUuid(seed) {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16], 16) & 3) | 8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function deviceIdentifier(seed) {
  return createHash("sha256").update(`station-complete-device:${seed}`).digest("hex").slice(0, 32).toUpperCase();
}

function iconSlug(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll(".", "-").toLowerCase();
}
