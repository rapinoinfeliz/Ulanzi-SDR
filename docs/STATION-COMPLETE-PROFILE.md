# Perfil SDR — Estação Completa

O perfil é distribuído como dois presets oficiais do Ulanzi Studio. Importe somente o arquivo correspondente ao dispositivo conectado; para usar D100H e D200X juntos, importe os dois.

- `profiles/station-complete/Station-Complete-D200X.ulanziDeckProfile`
- `profiles/station-complete/Station-Complete-D100H.ulanziDeckProfile`

Os arquivos usam o formato de perfil v2 (`#Version: 2`) observado nos presets fornecidos pelo Ulanzi Studio 3.2.11. A importação cria um perfil separado e não precisa substituir o perfil atual.

## D200X

### Teclas LCD

| Posição | Função | Operação |
|---|---|---|
| 0_0 | RX | start/stop receiver |
| 1_0 | MUTE | toggle mute |
| 2_0 | PRESET | aplicar preset selecionado |
| 3_0 | AM | definir modo AM |
| 4_0 | USB | definir modo USB |
| 0_1 | LSB | definir modo LSB |
| 1_1 | CW | definir modo CW |
| 2_1 | NFM | definir modo NFM |
| 3_1 | WFM | definir modo WFM |
| 4_1 | SQL | toggle squelch |
| 0_2 | DSP AGC | toggle DSP AGC |
| 1_2 | RF AGC | percorrer modos RF AGC |
| 2_2 | LNA | toggle HF+ LNA |
| 3_2 | REC | iniciar/parar gravação de áudio |

### Encoders

| Encoder | Giro | Pressão | Giro pressionado |
|---|---|---|---|
| 0 | bandwidth, 100 Hz/tick | janela do filtro | modo |
| 1 | volume, 2%/tick | mute | panning, 5%/tick |
| 2 | atenuação HF+ | LNA | RF AGC |

## D100H

### Dial

| Gesto | Função |
|---|---|
| giro | frequência usando o step atual |
| pressão | próximo step |
| giro pressionado | frequência central |

### Oito teclas

| Posição | Função |
|---|---|
| 0_0 | Snap to Grid |
| 1_0 | lock da frequência central |
| 2_0 | tuning style |
| 0_1 | frequency shift |
| 1_1 | freeze tuning style |
| 2_1 | mute |
| 1_2 | aplicar preset selecionado |
| 2_2 | gravação de áudio |

## Importação

1. Instale o plug-in `SDR Control` 0.4.0 ou posterior.
2. Conecte o D100H ou D200X e abra o Ulanzi Studio.
3. Abra `Preferências` → `Perfil/Arquivo de predefinição`.
4. Use `Importar` e escolha o `.ulanziDeckProfile` correspondente.
5. Selecione `SDR — Estação Completa` como perfil ativo.
6. Repita para o segundo dispositivo quando ambos forem usados.

O botão `PRESET` requer pelo menos um preset SDR configurado no painel do plug-in. Controles HF+ ficam indisponíveis quando a fonte conectada não anuncia `rf.agcMode`, `rf.lna` ou `rf.attenuationDb`. No SDR++ stock, volume, mute, RF e vários controles DSP continuam limitados pela superfície Rigctl.

## Regeneração

Edite `profiles/station-complete/profile.json` e execute:

```bash
npm run profiles:generate
```

O gerador usa IDs determinísticos, inclui os ícones OLED Minimal necessários e produz os dois arquivos importáveis sem depender de um banco interno do Ulanzi Studio.
