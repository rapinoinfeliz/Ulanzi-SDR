# Sistema de ícones OLED Minimal

O plug-in 0.3 usa um catálogo vetorial determinístico baseado na estética aprovada `OLED Minimal`.

## Linguagem visual

- canvas quadrado `144 × 144`, fundo preto e cantos de 22 px;
- pictograma primário branco `#F5F7F8`;
- informação ajustável ou seleção em azul elétrico `#278CFF`;
- gravação ativa em vermelho `#FF2D3D`;
- estado offline em cinza `#59616B`/`#343A40`;
- traços de 6–8 px, pontas arredondadas e ausência de sombras, gradientes ou textura;
- área inferior livre para o título e o valor enviados pelo renderer do Ulanzi Studio.

## Catálogo

O gerador produz três variantes para cada função:

- `normal`: função disponível;
- `active`: toggle/estado ativo, com contorno azul;
- `offline`: fonte ou adaptador indisponível.

São 50 símbolos: os 42 controles públicos do SDR#, três controles condicionais do Airspy HF+ e cinco funções gerais do plug-in. O índice legível por máquina fica em `controller/ulanzi-plugin/assets/oled/catalog.json`.

Execute `npm run icons:generate` sempre que o catálogo ou a geometria forem alterados. Os 150 SVGs resultantes são incluídos automaticamente em `npm run package:ulanzi`.

## Seleção em runtime

O renderer usa `setPathIcon`, disponível no SDK legado do Ulanzi Studio, e escolhe a imagem pelo controle principal de cada instância:

1. ação fixa → ícone correspondente à ação;
2. ação configurável → primeiro binding configurado, na ordem giro, pressão e giro pressionado;
3. ação em camadas → frequência, ganho RF ou preset conforme a camada ativa;
4. booleano verdadeiro/gravação → variante `active`;
5. SDR desconectado → variante `offline`.

Se o host rejeitar o caminho dinâmico, o renderer retorna aos estados declarados no manifesto.
