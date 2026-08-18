(() => {
  const endpoint = window.__ULANZI_SDR_ENDPOINT__;
  const status = document.querySelector("#status");
  const save = document.querySelector("#save");
  if (!endpoint) {
    status.textContent = "Hub indisponível. Abra o Ulanzi Studio novamente.";
    return;
  }
  const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}/property-inspector?token=${encodeURIComponent(endpoint.token)}`);
  let current = {};
  socket.addEventListener("open", () => {
    status.textContent = "Hub conectado";
    socket.send(JSON.stringify({ type: "config.get" }));
  });
  socket.addEventListener("close", () => status.textContent = "Hub desconectado");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "config.snapshot") return;
    current = message.settings;
    document.querySelector("#v31").checked = current.enableV31Feedback === true;
    document.querySelector("#rigctlPort").value = current.sdrppRigctlPort || 4532;
    document.querySelector("#layer").value = current.activeLayer || "radio";
    document.querySelector("#steps").value = (current.stepValuesHz || []).join(", ");
    document.querySelector("#presets").value = JSON.stringify(current.presets || [], null, 2);
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
})();
