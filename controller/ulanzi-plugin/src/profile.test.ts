import { readFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { normalizeMapping } from "./actions.js";

interface ProfileAction {
  Action: string;
  ActionParam: Record<string, unknown>;
  ViewParam: Array<{ Icon: string }>;
}

interface PageManifest {
  Controllers: Array<{ Type: string; Actions: Record<string, ProfileAction> }>;
}

interface RootManifest {
  Device: { Model: string };
  Icon: string;
  Name: string;
}

const profiles = [
  { file: "Station-Complete-D200X.ulanziDeckProfile", model: "D200X", keypad: 14, encoder: 3 },
  { file: "Station-Complete-D100H.ulanziDeckProfile", model: "Dial", keypad: 8, encoder: 1 }
];

describe("Station Complete profiles", () => {
  for (const expected of profiles) {
    it(`packages a valid ${expected.model} profile`, () => {
      const bytes = readFileSync(path.join("profiles/station-complete", expected.file));
      expect(bytes.subarray(0, 12).toString()).toBe("#Version: 2\n");
      const archive = unzipSync(bytes.subarray(12));
      const rootManifestPath = Object.keys(archive).find((name) => /^[^/]+\.ulanziProfile\/manifest\.json$/.test(name));
      const pageManifestPath = Object.keys(archive).find((name) => /\/Profiles\/[^/]+\/manifest\.json$/.test(name));
      expect(rootManifestPath).toBeDefined();
      expect(pageManifestPath).toBeDefined();
      const root = JSON.parse(strFromU8(archive[rootManifestPath!]!)) as RootManifest;
      const page = JSON.parse(strFromU8(archive[pageManifestPath!]!)) as PageManifest;
      expect(root.Device.Model).toBe(expected.model);
      expect(root.Name).toContain("Estação Completa");
      expect(archive[rootManifestPath!.replace(/manifest\.json$/, root.Icon)]).toBeDefined();

      const keypad = page.Controllers.find((item) => item.Type === "Keypad")?.Actions ?? {};
      const encoder = page.Controllers.find((item) => item.Type === "Encoder")?.Actions ?? {};
      expect(Object.keys(keypad)).toHaveLength(expected.keypad);
      expect(Object.keys(encoder)).toHaveLength(expected.encoder);

      if (expected.model === "D200X") {
        expect(keypad["3_2"]?.Action).toMatch(/\.recording$/);
        expect(keypad["3_0"]?.ActionParam).toMatchObject({ mapping: { press: { action: "set", control: "mode", value: "AM" } } });
        expect(encoder["2_2"]?.ActionParam).toMatchObject({ mapping: { rotate: { action: "cycle", control: "rf.attenuationDb" } } });
      } else {
        expect(keypad["2_2"]?.Action).toMatch(/\.recording$/);
        expect(encoder["0_2"]?.ActionParam).toMatchObject({
          mapping: {
            rotate: { action: "adjust", control: "frequencyHz" },
            press: { action: "cycle", control: "stepHz" },
            holdRotate: { action: "adjust", control: "centerFrequencyHz" }
          }
        });
      }

      for (const action of [...Object.values(keypad), ...Object.values(encoder)]) {
        expect(action.Action).toMatch(/^com\.ulanzi\.ulanzistudio\.sdrcontrol\./);
        const iconPath = pageManifestPath!.replace(/manifest\.json$/, action.ViewParam[0]!.Icon);
        expect(archive[iconPath]).toBeDefined();
        if (!action.Action.endsWith(".configurable")) continue;
        const settings = action.ActionParam as { kind?: string; mapping?: unknown };
        expect(settings.kind).toBe("configurable");
        expect(normalizeMapping(settings.mapping).title.length).toBeGreaterThan(0);
      }
    });
  }
});
