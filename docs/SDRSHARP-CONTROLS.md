# Controles configuráveis do SDR#

A ação `Configurable SDR# Control` possui três bindings independentes:

- `Giro`: ajuste numérico ou ciclo por opções;
- `Pressão`: toggle, ciclo ou definição de valor fixo;
- `Giro pressionado`: ajuste numérico ou ciclo por opções.

Cada instância mantém sua própria configuração através de `setSettings`; vários dials configuráveis podem executar funções completamente diferentes.

## Catálogo anunciado pelo adaptador 0.2

| Categoria | Controles |
|---|---|
| Tuning | frequência, frequência central, step, snap, frequency shift e seu valor, lock da frequência central, tuning style, freeze do estilo e tuning limit |
| Áudio | volume, mute, panning, unity gain e filtro de áudio |
| Demodulação | modo, bandwidth, janela do filtro, ordem do filtro, CW shift, FM stereo, carrier lock, anti-fading e bypass de demodulação |
| Squelch | enable e threshold |
| AGC | enable, hang, threshold, decay e slope |
| Fonte | swap I/Q e start/stop do receiver |
| Display | zoom, mark peaks, spectrum attack/decay, waterfall attack/decay e time markers |
| RDS | correção de erros/FEC |
| Recorder | iniciar/parar gravação de áudio |
| Airspy HF+ | RF AGC, LNA e atenuação, quando detectados na fonte instalada |

O painel é preenchido a partir das capacidades anunciadas em runtime. Funções indisponíveis na versão/fonte conectada não são oferecidas nos seletores compatíveis.

## Exemplos

### Dial de squelch

```text
Título: SQL
Giro: Ajustar valor → Squelch threshold → incremento 1
Pressão: Alternar → Squelch
Giro pressionado: Nenhuma
```

### Dial de filtro completo

```text
Título: FILTER
Giro: Ajustar valor → Filter bandwidth → incremento 100
Pressão: Percorrer opções → Filter window
Giro pressionado: Percorrer opções → Demodulation mode
```

### Controle de AGC

```text
Título: AGC
Giro: Ajustar valor → AGC threshold → incremento 1
Pressão: Alternar → DSP AGC
Giro pressionado: Ajustar valor → AGC decay → incremento 10
```

### Airspy HF+

```text
Título: HF+ RF
Giro: Percorrer opções → HF+ attenuation
Pressão: Alternar → HF+ LNA
Giro pressionado: Percorrer opções → HF+ RF AGC
```

Os limites descritos nas capacidades são aplicados novamente pelo adaptador SDR#; valores fora da faixa são limitados ou rejeitados no thread da interface do host.
