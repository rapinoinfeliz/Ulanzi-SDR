# Instalação no macOS com SDR++

## 1. Preparar o SDR++ original

1. Abra o SDR++ com o Airspy HF+ Discovery selecionado como fonte.
2. Crie ou habilite uma instância do módulo `Radio`; o nome padrão esperado pelo Rigctl normalmente é `Radio`.
3. Abra o módulo `Rigctl Server`.
4. Selecione o VFO da instância `Radio`, ative o controle de tuning e use a porta `4532`.
5. Para gravação, selecione uma instância do módulo `Recorder` e habilite o controle do recorder no Rigctl Server.
6. Habilite `Auto Start` no Rigctl Server ou inicie o servidor manualmente a cada sessão.

O plug-in conecta somente em `127.0.0.1`; não abre nem depende de acesso de rede externo. Se a porta for diferente, informe-a no painel de propriedades do plug-in Ulanzi.

## 2. Instalar o plug-in Ulanzi

1. Na raiz do projeto, execute:

   ```bash
   npm ci
   npm run package:ulanzi
   ```

2. Feche completamente o Ulanzi Studio.
3. Copie a pasta inteira `artifacts/com.ulanzi.ulanzistudio.sdrcontrol.ulanziPlugin` para:

   ```text
   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/
   ```

4. Abra novamente o Ulanzi Studio e procure a categoria `SDR`.
5. Arraste as ações desejadas para o D100H/D200X.

Esse é o formato de pacote e o diretório de plug-ins publicados pela documentação/comunidade oficial do Ulanzi Studio. Não copie apenas o conteúdo interno: o diretório terminado em `.ulanziPlugin` precisa ser preservado.

## 3. Configurar

No painel de propriedades de qualquer ação:

- mantenha a porta Rigctl igual à configurada no SDR++;
- informe os passos de frequência em Hz;
- adicione presets usando o modelo de `examples/presets.json`;
- mantenha `Feedback dinâmico V3.1` desligado no Studio 3.2.x; ative somente em versões que implementem `setFeedback`/`setFeedbackLayout`.

## 4. Verificação

1. Com Ulanzi Studio e SDR++ abertos, o botão `Frequency` deve deixar de mostrar `OFFLINE` em até dois segundos.
2. Gire o encoder e confirme a frequência no SDR++.
3. Teste `Mode`, `Filter` e um preset.
4. Para gravação, confirme também que `Recorder control` está habilitado no Rigctl Server. O retorno `RPRT 0` confirma apenas que o comando foi aceito; o Rigctl atual não oferece consulta do estado real do Recorder.

## Limites deliberados

O Rigctl nativo do SDR++ não oferece volume, mute nem controles do Airspy HF+. Essas ações aparecem como `UNAVAILABLE`. O projeto não usa atalhos de teclado, automação de interface, HID reverso ou alterações no SDR++ para contornar essa limitação.

