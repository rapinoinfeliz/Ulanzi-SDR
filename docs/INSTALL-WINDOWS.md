# Instalação no Windows com SDR#

## 1. Compilar o adaptador SDR#

Requisitos: PowerShell, .NET SDK 9 e SDR# 1.0.0.1921.

No PowerShell, a partir da raiz do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./adapters/sdrsharp/build.ps1
```

O script baixa o SDK oficial 1921, valida o SHA-256 e compila:

```text
adapters/sdrsharp/bin/Release/net9.0-windows/SDRSharp.UlanziAdapter.dll
```

Não distribua as DLLs `SDRSharp.Common.dll` e `SDRSharp.Radio.dll` copiadas em `lib/`; elas servem apenas como referências de compilação.

## 2. Instalar no SDR#

1. Feche o SDR#.
2. Copie `SDRSharp.UlanziAdapter.dll` para o diretório configurado em `core.pluginsDirectory` no SDR#. Na instalação padrão 1921, esse diretório costuma ser a própria pasta do programa.
3. Abra o SDR# e confirme `Ulanzi SDR Control` na categoria `Control` dos plug-ins.
4. Selecione o Airspy HF+ Discovery e inicie a recepção.

O plug-in procura automaticamente o endpoint local publicado pelo Ulanzi Studio e reconecta com backoff; não há host, porta ou token para configurar manualmente.

## 3. Instalar o plug-in Ulanzi

1. Execute `npm ci` e `npm run package:ulanzi` em uma máquina com Node.js, ou use a pasta já produzida em `artifacts/`.
2. Feche o Ulanzi Studio.
3. Copie `artifacts/com.ulanzi.sdrcontrol.ulanziPlugin` para:

   ```text
   %APPDATA%\Ulanzi\UlanziDeck\Plugins\
   ```

4. Reinicie o Ulanzi Studio e adicione as ações da categoria `SDR`.

## 4. Gravação e ganho HF+

- `Audio Recording` grava o áudio demodulado `MonitorAF` em WAV PCM mono de 16 bits dentro de `Documentos\SDRSharp Recordings` e cria um JSON adjacente com frequência, modo, bandwidth, sample rate e buffers perdidos.
- O adaptador limita cada WAV a aproximadamente 2 GB.
- Volume, mute, tuning, step, modo e filtro usam membros públicos de `ISharpControl`.
- AGC, LNA e atenuação do HF+ são detectados em runtime. A ação só é anunciada quando a fonte Airspy da versão instalada expõe propriedades públicas compatíveis; caso contrário, o display mostra `UNAVAILABLE`.
