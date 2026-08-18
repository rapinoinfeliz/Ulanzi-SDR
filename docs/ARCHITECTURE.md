# Arquitetura

## Componentes

```text
D100H / D200X
      │ eventos e feedback do SDK oficial
      ▼
Plug-in Node do Ulanzi Studio
  ├─ ações, presets, passos e camadas
  ├─ feedback legado setStateIcon
  ├─ feedback D200X V3.1 opcional
  └─ hub WebSocket autenticado em 127.0.0.1
         ├─ macOS: adaptador Rigctl interno ─ TCP 127.0.0.1:4532 ─ SDR++ original
         └─ Windows: plug-in SDR# ─ ISharpControl / MonitorAF ─ SDR#
```

O hub escolhe um único adaptador ativo. No macOS, o adaptador Rigctl é iniciado dentro do processo Node do plug-in. No Windows, o DLL do SDR# descobre o endpoint em `%LOCALAPPDATA%\UlanziSDR\endpoint.json`.

## Decisões de robustez

- Apenas loopback; token aleatório de 256 bits; arquivo de descoberta com permissão restrita quando suportada.
- Mensagens limitadas a 64 KiB e validadas contra JSON Schema.
- Um adaptador por vez, IDs idempotentes, timeout de comando, revisão otimista e heartbeat.
- Rigctl serializado em uma fila única porque o handler do SDR++ declara não ser thread-safe e aceita um cliente ativo.
- Polling de frequência/modo/bandwidth em 1 Hz; comandos atualizam o display imediatamente após leitura de confirmação.
- Nenhum caminho por mouse, teclado, MIDI/HID reverso ou WebSocket não oficial.
- D100H e D200X usam o mesmo SDK do Ulanzi Studio. O projeto não assume que técnicas documentadas para o D200 sejam válidas no D200X.

## Estado canônico

O hub mantém frequência, step, volume, mute, modo, bandwidth, RF, recorder e métricas. Cada adaptador anuncia capacidades; o renderer usa essa lista para exibir `UNAVAILABLE` quando uma função não existe no host.

Presets e camadas pertencem ao plug-in Ulanzi, portanto funcionam da mesma forma nos dois sistemas. Ao aplicar um preset, cada adaptador usa apenas os campos suportados.

As instâncias de `Configurable SDR# Control` persistem um mapa por contexto Ulanzi. O painel recebe o catálogo de capacidades autenticado do hub, salva o binding com `setSettings` e nunca oferece um controle como se fosse universal: o adaptador conectado continua sendo a autoridade sobre disponibilidade, faixa e valores.

## Camadas

`Layer` alterna globalmente:

- `RADIO`: o `Layered Control` sintoniza; pressionar troca o step.
- `RF`: gira atenuação; pressionar alterna LNA quando disponível; girar pressionado troca o AGC.
- `MEMORY`: gira entre presets; pressionar aplica.

As ações dedicadas continuam disponíveis em qualquer camada.

## Compatibilidade SDR++

Comandos usados: `f`, `F`, `m`, `M`, `\\recorder_start` e `\\recorder_stop`. A integração pública do Ulanzi não expõe start/stop como ação porque o Rigctl atual não fornece consulta confiável desse estado.

O Rigctl responde sucesso mesmo quando o controle de tuning/recording está desativado. Por isso a instalação exige habilitar explicitamente essas opções no módulo e documenta a gravação como estado local não verificável.

## Compatibilidade SDR#

O alvo validado é SDR# 1.0.0.1921, .NET 9 e a arquitetura x86 usada pelo host. O SDK público cobre todas as funções DSP e áudio. Os controles de fonte HF+ são um shim experimental, restrito por nome da fonte, inspeção pública e verificação após escrita; a ausência das propriedades desabilita a capacidade sem derrubar o plug-in.
