import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = "controller/ulanzi-plugin/assets/oled";

const controls = [
  ["frequencyHz", "Frequency", "Tuning", "dial"],
  ["centerFrequencyHz", "Center frequency", "Tuning", "target"],
  ["stepHz", "Tuning step", "Tuning", "steps"],
  ["snapToGrid", "Snap to grid", "Tuning", "grid"],
  ["frequencyShift.enabled", "Frequency shift", "Tuning", "shift"],
  ["frequencyShiftHz", "Frequency shift value", "Tuning", "shiftValue"],
  ["centerFrequencyLocked", "Lock center frequency", "Tuning", "lockTarget"],
  ["tuning.style", "Tuning style", "Tuning", "selector"],
  ["tuning.styleFrozen", "Freeze tuning style", "Tuning", "freeze"],
  ["tuning.limit", "Tuning limit", "Tuning", "limit"],
  ["volume", "Volume", "Audio", "speaker"],
  ["muted", "Mute", "Audio", "mute"],
  ["audio.panning", "Audio panning", "Audio", "panning"],
  ["unityGain", "Unity gain", "Audio", "unity"],
  ["filter.audio", "Audio filter", "Audio", "audioFilter"],
  ["mode", "Demodulation mode", "Demodulation", "mode"],
  ["bandwidthHz", "Filter bandwidth", "Demodulation", "filter"],
  ["filter.type", "Filter window", "Demodulation", "window"],
  ["filter.order", "Filter order", "Demodulation", "layers"],
  ["cwShiftHz", "CW shift", "Demodulation", "cw"],
  ["fm.stereo", "FM stereo", "Demodulation", "stereo"],
  ["carrier.lock", "Carrier lock", "Demodulation", "carrierLock"],
  ["antiFading", "Anti-fading", "Demodulation", "fading"],
  ["demodulation.bypass", "Bypass demodulation", "Demodulation", "bypass"],
  ["squelch.enabled", "Squelch", "Squelch", "gate"],
  ["squelch.threshold", "Squelch threshold", "Squelch", "gateThreshold"],
  ["dsp.agc", "DSP AGC", "AGC", "meter"],
  ["agc.hang", "AGC hang", "AGC", "hold"],
  ["agc.threshold", "AGC threshold", "AGC", "meterThreshold"],
  ["agc.decay", "AGC decay", "AGC", "decay"],
  ["agc.slope", "AGC slope", "AGC", "slope"],
  ["iq.swap", "Swap I/Q", "Source", "swap"],
  ["receiverRunning", "Receiver", "Source", "power"],
  ["zoom", "Spectrum zoom", "Display", "zoom"],
  ["spectrum.markPeaks", "Mark peaks", "Display", "peaks"],
  ["spectrum.attack", "Spectrum attack", "Display", "rise"],
  ["spectrum.decay", "Spectrum decay", "Display", "fall"],
  ["waterfall.attack", "Waterfall attack", "Display", "waterUp"],
  ["waterfall.decay", "Waterfall decay", "Display", "waterDown"],
  ["spectrum.timeMarkers", "Time markers", "Display", "clock"],
  ["rds.useFec", "RDS error correction", "RDS", "shield"],
  ["record.audio", "Audio recording", "Recorder", "record"],
  ["rf.agcMode", "HF+ RF AGC", "Airspy HF+", "antennaMeter"],
  ["rf.lna", "HF+ LNA", "Airspy HF+", "antennaPlus"],
  ["rf.attenuationDb", "HF+ attenuation", "Airspy HF+", "antennaAttenuation"],
  ["preset", "Preset", "General", "bookmark"],
  ["layer", "Layer", "General", "stack"],
  ["layered", "Layered control", "General", "layered"],
  ["configurable", "Configurable control", "General", "sliders"],
  ["plugin", "SDR Control", "General", "wave"]
].map(([id, label, category, glyph]) => ({ id, label, category, glyph }));

const states = {
  normal: { background: "#000000", primary: "#F5F7F8", accent: "#278CFF", border: false },
  active: { background: "#000000", primary: "#FFFFFF", accent: "#278CFF", border: true },
  offline: { background: "#07090B", primary: "#59616B", accent: "#343A40", border: false }
};

await mkdir(outputRoot, { recursive: true });

for (const control of controls) {
  for (const [state, palette] of Object.entries(states)) {
    const accent = control.id === "record.audio" && state === "active" ? "#FF2D3D" : palette.accent;
    const file = path.join(outputRoot, `${fileSlug(control.id)}-${state}.svg`);
    await writeFile(file, renderIcon(control, { ...palette, accent }), "utf8");
  }
}

await writeFile(
  path.join(outputRoot, "catalog.json"),
  `${JSON.stringify({ style: "OLED Minimal", version: 1, controls: controls.map(({ glyph, ...control }) => ({
    ...control,
    files: Object.fromEntries(Object.keys(states).map((state) => [state, `${fileSlug(control.id)}-${state}.svg`]))
  })) }, null, 2)}\n`,
  "utf8"
);

console.log(`Generated ${controls.length * Object.keys(states).length} OLED Minimal SVGs for ${controls.length} functions.`);

function renderIcon(control, palette) {
  const border = palette.border
    ? `<rect x="4" y="4" width="136" height="136" rx="20" fill="none" stroke="${palette.accent}" stroke-width="5"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(control.label)} — OLED Minimal</title>
  <rect width="144" height="144" rx="22" fill="${palette.background}"/>
  ${border}
  ${glyph(control.glyph, palette.primary, palette.accent)}
</svg>\n`;
}

function glyph(name, primary, accent) {
  const line = `fill="none" stroke="${primary}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `fill="none" stroke="${primary}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`;
  const blue = `fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  const pfill = `fill="${primary}"`;
  const afill = `fill="${accent}"`;
  switch (name) {
    case "dial": return `<circle cx="72" cy="58" r="38" ${line}/><circle cx="72" cy="58" r="7" ${pfill}/><path d="M72 58l24-24" ${blue}/><path d="M106 31c8 7 12 16 14 26" ${blue}/>`;
    case "target": return `<circle cx="72" cy="57" r="38" ${line}/><circle cx="72" cy="57" r="17" ${blue}/><path d="M72 13v18M72 83v18M28 57h18M98 57h18" ${thin}/>`;
    case "steps": return `<path d="M30 88h20V70h20V52h20V34h24" ${line}/><path d="M95 24l19 10-19 10" ${blue}/>`;
    case "grid": return `<path d="M34 24v70M55 24v70M76 24v70M97 24v70M26 36h80M26 57h80M26 78h80" ${thin}/><path d="M72 33v48M48 57h48" ${blue}/>`;
    case "shift": return `<path d="M28 44h78M94 31l14 13-14 13M110 76H32M44 63L30 76l14 13" ${line}/>`;
    case "shiftValue": return `<path d="M24 58h88M98 44l14 14-14 14" ${line}/><circle cx="52" cy="58" r="13" fill="${paletteSafe(primary)}" stroke="${accent}" stroke-width="7"/>`;
    case "lockTarget": return `<circle cx="58" cy="57" r="31" ${line}/><circle cx="58" cy="57" r="10" ${blue}/><rect x="78" y="59" width="35" height="31" rx="6" ${pfill}/><path d="M86 60V50a9 9 0 0118 0v10" ${blue}/>`;
    case "selector": return `<circle cx="72" cy="60" r="32" ${line}/><circle cx="72" cy="60" r="7" ${pfill}/><path d="M72 60L51 38" ${blue}/><circle cx="36" cy="30" r="5" ${pfill}/><circle cx="108" cy="30" r="5" ${pfill}/><circle cx="112" cy="78" r="5" ${pfill}/>`;
    case "freeze": return `<path d="M72 18v78M38 38l68 39M38 77l68-39M62 29l10 10 10-10M62 85l10-10 10 10" ${line}/><circle cx="72" cy="57" r="8" ${afill}/>`;
    case "limit": return `<path d="M28 25v67M116 25v67M45 58h54" ${line}/><path d="M45 58l14-12v24zM99 58L85 46v24z" ${afill}/>`;
    case "speaker": return `<path d="M28 50h20l25-22v58L48 65H28z" ${pfill}/><path d="M86 44c8 8 8 20 0 28M99 32c16 15 16 37 0 52" ${blue}/>`;
    case "mute": return `<path d="M26 50h20l25-22v58L46 65H26z" ${pfill}/><path d="M84 43l27 29M111 43L84 72" ${blue}/>`;
    case "panning": return `<path d="M31 65V51a41 41 0 0182 0v14" ${line}/><rect x="24" y="58" width="20" height="30" rx="8" ${pfill}/><rect x="100" y="58" width="20" height="30" rx="8" ${pfill}/><path d="M52 78h40M80 66l12 12-12 12" ${blue}/>`;
    case "unity": return `<path d="M35 34h20v52H35M89 34h20v52H89" ${line}/><path d="M65 48h14M65 72h14" ${blue}/>`;
    case "audioFilter": return `<path d="M24 60h18l8-24 13 47 15-57 12 34h30" ${line}/><path d="M60 25h28L81 46v24l-14 8V46z" ${blue}/>`;
    case "mode": return `<circle cx="72" cy="31" r="10" ${afill}/><circle cx="36" cy="78" r="10" ${line}/><circle cx="108" cy="78" r="10" ${line}/><path d="M66 40L42 69M78 40l24 29M47 78h50" ${thin}/>`;
    case "filter": return `<path d="M20 86h19l8-12 8 12h14V38h22v48h14l8-12 8 12h8" ${line}/><rect x="68" y="30" width="24" height="64" rx="5" ${blue}/>`;
    case "window": return `<path d="M25 82h18V58c0-17 12-30 29-30s29 13 29 30v24h18" ${line}/><path d="M43 82h58" ${blue}/>`;
    case "layers": return `<path d="M72 21l47 24-47 24-47-24z" ${line}/><path d="M31 63l41 21 41-21M37 81l35 18 35-18" ${blue}/>`;
    case "cw": return `<circle cx="30" cy="56" r="7" ${pfill}/><path d="M48 56h24M87 56h29" ${line}/><path d="M54 80h48M90 68l14 12-14 12" ${blue}/>`;
    case "stereo": return `<circle cx="55" cy="57" r="29" ${line}/><circle cx="89" cy="57" r="29" ${blue}/>`;
    case "carrierLock": return `<path d="M22 66c10 0 10-25 20-25s10 32 20 32 10-39 20-39 10 32 20 32 10-18 20-18" ${line}/><rect x="79" y="57" width="34" height="30" rx="6" ${afill}/><path d="M87 57V48a9 9 0 0118 0v9" ${thin}/>`;
    case "fading": return `<path d="M22 64c10 0 10-30 20-30s10 44 20 44 10-52 20-52 10 39 20 39 10-21 20-21" ${line}/><path d="M28 89h86" ${blue}/>`;
    case "bypass": return `<path d="M23 60c9 0 9-24 18-24s9 38 18 38 9-47 18-47 9 36 18 36" ${thin}/><path d="M30 91c18 12 57 12 79-8M96 73l15 10-10 15" ${blue}/>`;
    case "gate": return `<path d="M24 84h34V35h28v49h34" ${line}/><path d="M58 84h28" ${blue}/>`;
    case "gateThreshold": return `<path d="M22 84h32V38h36v46h32" ${line}/><path d="M20 62h104" ${blue}/>`;
    case "meter": return `<path d="M26 81a49 49 0 0192 0" ${line}/><path d="M72 78l29-34" ${blue}/><circle cx="72" cy="78" r="8" ${pfill}/>`;
    case "hold": return `<path d="M24 81a51 51 0 0196 0M72 78l25-31" ${line}/><path d="M48 35v24M61 35v24" ${blue}/>`;
    case "meterThreshold": return `<path d="M24 82a51 51 0 0196 0M72 78l24-31" ${line}/><path d="M99 36v51" ${blue}/>`;
    case "decay": return `<path d="M24 32h26c12 0 19 5 26 17l36 40" ${line}/><path d="M94 88h20V68" ${blue}/>`;
    case "slope": return `<path d="M24 88h96M31 81l73-50" ${line}/><path d="M92 29h16v17" ${blue}/>`;
    case "swap": return `<path d="M27 37h17c25 0 31 42 56 42h17M102 67l15 12-15 12M27 79h17c25 0 31-42 56-42h17M102 25l15 12-15 12" ${line}/><circle cx="33" cy="37" r="5" ${afill}/><circle cx="33" cy="79" r="5" ${afill}/>`;
    case "power": return `<path d="M72 18v42" ${blue}/><path d="M48 31a39 39 0 1048 0" ${line}/>`;
    case "zoom": return `<circle cx="60" cy="53" r="31" ${line}/><path d="M82 76l30 27M60 38v30M45 53h30" ${blue}/>`;
    case "peaks": return `<path d="M20 87l20-36 15 23 19-49 18 43 13-22 19 41" ${line}/><circle cx="40" cy="51" r="5" ${afill}/><circle cx="74" cy="25" r="5" ${afill}/><circle cx="105" cy="46" r="5" ${afill}/>`;
    case "rise": return `<rect x="26" y="69" width="15" height="22" rx="3" ${pfill}/><rect x="52" y="54" width="15" height="37" rx="3" ${pfill}/><rect x="78" y="39" width="15" height="52" rx="3" ${pfill}/><path d="M27 52l30-20 23 8 32-21" ${blue}/>`;
    case "fall": return `<rect x="26" y="38" width="15" height="53" rx="3" ${pfill}/><rect x="52" y="53" width="15" height="38" rx="3" ${pfill}/><rect x="78" y="69" width="15" height="22" rx="3" ${pfill}/><path d="M27 22l30 20 23-8 32 21" ${blue}/>`;
    case "waterUp": return `<path d="M31 91V35M52 91V47M73 91V25M94 91V42M115 91V58" ${line}/><path d="M21 39l10-13 10 13M63 30l10-13 10 13" ${blue}/>`;
    case "waterDown": return `<path d="M31 23v56M52 23v44M73 23v66M94 23v49M115 23v33" ${line}/><path d="M21 76l10 13 10-13M63 76l10 13 10-13" ${blue}/>`;
    case "clock": return `<circle cx="72" cy="57" r="39" ${line}/><path d="M72 35v25l19 12" ${blue}/><path d="M72 18v8M72 88v8M33 57h8M103 57h8" ${thin}/>`;
    case "shield": return `<path d="M72 18l39 14v26c0 24-16 37-39 45-23-8-39-21-39-45V32z" ${line}/><path d="M51 59l14 14 29-31" ${blue}/>`;
    case "record": return `<circle cx="72" cy="57" r="39" fill="none" stroke="${primary}" stroke-width="7"/><circle cx="72" cy="57" r="24" ${afill}/>`;
    case "antennaMeter": return `<path d="M72 85V42M52 85h40M59 42l13-18 13 18M35 44c-14 14-14 36 0 50M109 44c14 14 14 36 0 50" ${line}/><path d="M49 62a25 25 0 0146 0M72 61l17-14" ${blue}/>`;
    case "antennaPlus": return `<path d="M72 89V43M52 89h40M59 43l13-19 13 19M39 45c-14 14-14 34 0 48M105 45c14 14 14 34 0 48" ${line}/><path d="M101 25v24M89 37h24" ${blue}/>`;
    case "antennaAttenuation": return `<path d="M58 88V43M40 88h36M46 43l12-19 12 19M28 47c-12 12-12 31 0 43M88 47c12 12 12 31 0 43" ${line}/><path d="M91 37h27M98 50l13-26" ${blue}/>`;
    case "bookmark": return `<path d="M43 20h58v82L72 83l-29 19z" ${line}/><path d="M72 35l6 12 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2z" ${afill}/>`;
    case "stack": return `<path d="M72 20l48 23-48 23-48-23zM31 65l41 20 41-20M39 84l33 16 33-16" ${line}/><path d="M72 20v46" ${blue}/>`;
    case "layered": return `<circle cx="72" cy="58" r="16" ${afill}/><circle cx="31" cy="30" r="12" ${line}/><circle cx="113" cy="30" r="12" ${line}/><circle cx="72" cy="96" r="12" ${line}/><path d="M42 37l20 14M102 37L82 51M72 74v10" ${thin}/>`;
    case "sliders": return `<path d="M31 20v76M72 20v76M113 20v76" ${line}/><circle cx="31" cy="43" r="11" fill="${accent}" stroke="${primary}" stroke-width="5"/><circle cx="72" cy="73" r="11" fill="${accent}" stroke="${primary}" stroke-width="5"/><circle cx="113" cy="35" r="11" fill="${accent}" stroke="${primary}" stroke-width="5"/>`;
    case "wave": return `<path d="M18 66h22l9-32 14 56 16-73 15 50h32" ${line}/><circle cx="112" cy="31" r="10" ${afill}/>`;
    default: return `<circle cx="72" cy="57" r="38" ${line}/><path d="M72 35v30M72 80v2" ${blue}/>`;
  }
}

function fileSlug(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll(".", "-").toLowerCase();
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function paletteSafe(value) {
  return value;
}
