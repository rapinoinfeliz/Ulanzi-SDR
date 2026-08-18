# Protocolo de controle v1

Transporte: WebSocket texto em `ws://127.0.0.1:<porta>/control/v1`. O endpoint e token efêmeros ficam em:

- Windows: `%LOCALAPPDATA%\UlanziSDR\endpoint.json`
- macOS: `~/Library/Application Support/UlanziSDR/endpoint.json`

O adaptador deve enviar `adapter.hello` em até três segundos, com `protocolVersion`, token, identificação do host e mapa de capacidades. Em seguida envia `state.snapshot` ou `state.patch`.

Comandos do hub:

- `control.adjust`: `{ control, ticks }`
- `control.set`: `{ control, value }`
- `control.cycle`: `{ control, direction }`
- `preset.apply`: `{ preset }`
- `record.audio.set`: `{ enabled }`

Todo comando inclui UUID e `expectedRevision`. O adaptador responde `command.result`; erros usam `unsupported`, `invalid`, `conflict`, `not_ready`, `host_mismatch`, `io_error` ou `internal`.

O schema completo está em `protocol/schemas/control-v1.schema.json`. Alterações incompatíveis exigem nova versão de endpoint; novos campos opcionais devem ser anunciados por capacidade.

