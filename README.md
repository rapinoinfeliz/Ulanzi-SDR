# Ulanzi SDR Control

Integração local e bidirecional dos controladores Ulanzi D100H/D200X com:

- SDR++ original no macOS, usando exclusivamente o servidor Rigctl TCP já incluído no programa;
- SDR# no Windows, usando um plug-in público `ISharpPlugin` e a API `ISharpControl`.

Nenhum patch ou recompilação do SDR++ é necessário. O plug-in do Ulanzi Studio contém o hub, o adaptador Rigctl e a interface dos controles.

## Estado da implementação

| Função | SDR# / Windows | SDR++ original / macOS |
|---|---:|---:|
| Frequência e passos | Sim | Sim |
| Modo e bandwidth | Sim | Sim |
| Volume e mute | Sim | Não exposto por Rigctl |
| Ganho/AGC/atenuação HF+ | Experimental e detectado em runtime | Não exposto por Rigctl |
| Presets | Sim | Sim, campos suportados |
| Camadas | Sim | Sim |
| Feedback em teclas/display | Sim | Sim |
| Gravação de áudio | WAV pelo plug-in | Comando para o Recorder do SDR++ |

No macOS, botões sem API correspondente exibem `UNAVAILABLE` em vez de simular uma operação por teclado ou mouse.

## Artefatos

- Plug-in Ulanzi Studio: `artifacts/com.ulanzi.sdrcontrol.ulanziPlugin/`
- Plug-in SDR#: `adapters/sdrsharp/bin/Release/net9.0-windows/SDRSharp.UlanziAdapter.dll`

O diretório do Ulanzi é produzido por `npm run package:ulanzi`. O DLL do SDR# é produzido no Windows por `adapters/sdrsharp/build.ps1`.

## Instalação

- [macOS + SDR++](docs/INSTALL-MACOS.md)
- [Windows + SDR#](docs/INSTALL-WINDOWS.md)
- [Arquitetura e limites](docs/ARCHITECTURE.md)
- [Protocolo IPC](docs/PROTOCOL.md)

## Desenvolvimento e validação

Requisitos: Node.js 20.12.2 ou superior; para o adaptador Windows, .NET SDK 9.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run package:ulanzi
npm audit
```

O projeto fixa versões de dependências e o commit do SDK Node oficial do Ulanzi. O download do SDK SDR# é conferido por SHA-256 antes do build.

## Controles disponíveis no Ulanzi Studio

- `Frequency`: giro sintoniza; pressão ou giro pressionado troca o passo.
- `Volume / Mute`: giro ajusta volume; pressão alterna mute.
- `Filter / Mode`: giro ajusta bandwidth; pressão ou giro pressionado troca o modo.
- `RF Gain`: giro ajusta atenuação; pressão alterna LNA quando disponível; giro pressionado troca AGC.
- `Preset`: giro seleciona; pressão aplica.
- `Audio Recording`: pressão inicia ou encerra a gravação.
- `Layer`: alterna `RADIO`, `RF` e `MEMORY`.
- `Layered Control`: um único encoder cujo comportamento acompanha a camada: tuning, ganho RF ou presets.

Os passos, presets, porta Rigctl e feedback D200X são editados no painel de propriedades de qualquer ação.
