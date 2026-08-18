(() => {
  const endpoint = window.__ULANZI_SDR_ENDPOINT__;
  const status = document.querySelector("#status");
  const save = document.querySelector("#save");
  const saveAction = document.querySelector("#saveAction");
  const query = new URLSearchParams(window.location.search);
  const contextParts = [query.get("uuid"), query.get("key"), query.get("actionid")];
  const context = contextParts.every(Boolean) ? contextParts.join("___") : "";
  if (!endpoint) {
    status.textContent = "Hub indisponível. Abra o Ulanzi Studio novamente.";
    return;
  }
  const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}/property-inspector?token=${encodeURIComponent(endpoint.token)}&context=${encodeURIComponent(context)}`);
  let current = {};
  let capabilities = {};
  let actionConfiguration = {};
  socket.addEventListener("open", () => {
    status.textContent = "Hub conectado";
    socket.send(JSON.stringify({ type: "config.get" }));
  });
  socket.addEventListener("close", () => status.textContent = "Hub desconectado");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error") { status.textContent = message.message; return; }
    if (message.type !== "config.snapshot") return;
    current = message.settings;
    capabilities = message.capabilities || capabilities;
    actionConfiguration = message.action || actionConfiguration;
    document.querySelector("#v31").checked = current.enableV31Feedback === true;
    document.querySelector("#rigctlPort").value = current.sdrppRigctlPort || 4532;
    document.querySelector("#layer").value = current.activeLayer || "radio";
    document.querySelector("#steps").value = (current.stepValuesHz || []).join(", ");
    document.querySelector("#presets").value = JSON.stringify(current.presets || [], null, 2);
    renderActionConfiguration();
  });
  save.addEventListener("click", () => {
    try {
      const settings = {
        ...current,
        enableV31Feedback: document.querySelector("#v31").checked,
        sdrppRigctlPort: Number(document.querySelector("#rigctlPort").value),
        activeLayer: document.querySelector("#layer").value,
        stepValuesHz: document.querySelector("#steps").value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0),
        presets: JSON.parse(document.querySelector("#presets").value)
      };
      socket.send(JSON.stringify({ type: "config.set", settings }));
      status.textContent = "Configuração enviada";
    } catch (error) {
      status.textContent = `JSON inválido: ${error.message}`;
    }
  });

  for (const prefix of ["rotate", "press", "holdRotate"]) {
    document.querySelector(`#${prefix}Action`).addEventListener("change", () => refreshControlOptions(prefix));
  }

  saveAction.addEventListener("click", () => {
    const mapping = {
      title: document.querySelector("#actionTitle").value.trim() || "CUSTOM",
      rotate: readBinding("rotate"),
      press: readBinding("press"),
      holdRotate: readBinding("holdRotate")
    };
    socket.send(JSON.stringify({ type: "action.config.set", mapping }));
    status.textContent = "Configuração do controlo enviada";
  });

  function renderActionConfiguration() {
    const section = document.querySelector("#actionConfig");
    if (actionConfiguration.kind !== "configurable") { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");
    const mapping = actionConfiguration.mapping || {};
    document.querySelector("#actionTitle").value = mapping.title || "CUSTOM";
    renderBinding("rotate", mapping.rotate);
    renderBinding("press", mapping.press);
    renderBinding("holdRotate", mapping.holdRotate);
  }

  function renderBinding(prefix, binding) {
    const action = binding?.action || "none";
    document.querySelector(`#${prefix}Action`).value = action;
    refreshControlOptions(prefix, binding?.control);
    const amount = document.querySelector(`#${prefix}Amount`);
    if (amount) amount.value = binding?.amount ?? descriptor(binding?.control)?.step ?? 1;
    const inverted = document.querySelector(`#${prefix}Inverted`);
    if (inverted) inverted.checked = binding?.inverted === true;
    const fixed = document.querySelector(`#${prefix}Value`);
    if (fixed) fixed.value = binding?.value ?? "";
  }

  function refreshControlOptions(prefix, preferred) {
    const action = document.querySelector(`#${prefix}Action`).value;
    const select = document.querySelector(`#${prefix}Control`);
    const previous = preferred || select.value;
    const groups = new Map();
    for (const [name, description] of Object.entries(capabilities)) {
      if (!canWrite(description) || !supportsAction(description, action)) continue;
      const category = description.category || "Outros";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push({ name, label: description.label || name });
    }
    select.innerHTML = "";
    for (const [category, controls] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const group = document.createElement("optgroup");
      group.label = category;
      for (const control of controls.sort((a, b) => a.label.localeCompare(b.label))) {
        const option = document.createElement("option");
        option.value = control.name;
        option.textContent = control.label;
        group.append(option);
      }
      select.append(group);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    const disabled = action === "none";
    select.disabled = disabled;
    const amount = document.querySelector(`#${prefix}Amount`);
    if (amount) amount.disabled = action !== "adjust";
    const fixed = document.querySelector(`#${prefix}Value`);
    if (fixed) fixed.disabled = action !== "set";
  }

  function readBinding(prefix) {
    const action = document.querySelector(`#${prefix}Action`).value;
    if (action === "none") return null;
    const control = document.querySelector(`#${prefix}Control`).value;
    const binding = { action, control };
    const amount = document.querySelector(`#${prefix}Amount`);
    if (action === "adjust" && amount) binding.amount = Number(amount.value);
    const inverted = document.querySelector(`#${prefix}Inverted`);
    if (inverted?.checked) binding.inverted = true;
    const fixed = document.querySelector(`#${prefix}Value`);
    if (action === "set" && fixed) binding.value = parseFixedValue(fixed.value, descriptor(control));
    return binding;
  }

  function descriptor(control) { return capabilities[control] || {}; }
  function canWrite(value) { return value.access === "write" || value.access === "readwrite"; }
  function supportsAction(value, action) {
    if (action === "none") return true;
    const values = Array.isArray(value.values) ? value.values : [];
    if (action === "toggle") return values.length === 2 && values.every((item) => typeof item === "boolean");
    if (action === "cycle") return values.length > 1;
    if (action === "adjust") return values.length === 0;
    return action === "set";
  }
  function parseFixedValue(raw, description) {
    const values = Array.isArray(description.values) ? description.values : [];
    if (values.every((item) => typeof item === "boolean") && values.length) return raw === "true" || raw === "1" || raw.toLowerCase() === "on";
    if (values.some((item) => typeof item === "number")) return Number(raw);
    if (typeof description.minimum === "number" || typeof description.maximum === "number" || typeof description.step === "number") return Number(raw);
    return raw;
  }
})();
