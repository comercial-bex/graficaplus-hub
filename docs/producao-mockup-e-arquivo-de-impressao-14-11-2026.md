# Produção: mockup × arquivo de impressão (14/11/2026)

Pedido do dono: a produção recebe o arquivo do atendimento e da criação e manda
para a fila do operador de máquina. Quer que dê para **baixar** o arquivo anexado e
que fique **nítido** o que é o **mockup** (o visual que a gente vende, a peça
aplicada) e o que é o **arquivo de impressão** (o que vai para a máquina ou para a
diagramação).

## O que foi visto

### No banco

- **Permissão.** Ensaio com o perfil da Maiara (operadora): a tabela `arquivos` e o
  Storage liberam os arquivos das OS em produção, inclusive:
  - o `.3mf` do 3D;
  - o PDF que veio pelo WhatsApp (`whatsapp-midias`).

  Quando "não baixava", o defeito era da tela, não da permissão.
- **Tipos misturados.** O tipo `arte` guarda os mockups do orçamento
  ("Placa corporativa Ademicon em acrílico.png", "Copo térmico vermelho
  AMAPUERA.png") **e** PDFs fechados ("arte_bem_vindos_com_sabor.pdf",
  "chaveiro_10kits.pdf"). Nada separa um do outro.
- **Finais repetidos.** A OS 174 tinha três versões do mesmo JPG, todas marcadas
  como final de produção.
- **OS em produção sem arquivo.** Das 4 OS em `producao`, só 1 tinha arquivo final
  ou aprovado.

### Na tela

| Onde | O que fazia |
| --- | --- |
| Ficha do quadro | Um bloco só, "Arte · o que vai ser impresso", com mockup e PDF juntos. "Abrir" só abria, e CDR/AI/3MF o navegador não mostra. O bucket era fixo, então o que veio pelo WhatsApp não abria. |
| OS › Arquivos | "Baixar" abria uma aba no bucket fixo e, se falhasse, não dizia nada. O "Tipo" do formulário era recolhido e não gravado (tudo virava `outro`). "Marcar como final" dizia "marcado" mesmo quando o banco recusava. Nome com acento fazia o Storage recusar o envio ("Invalid key"). |
| Minha oficina (operador) | Nenhum arquivo. Era abrir a OS para achar. |

## Benchmark

| Sistema | Como separa |
| --- | --- |
| [YoPrint](https://support.yoprint.com/article/45-mockup-file-vs-production-file) | Duas abas: **Mockup Files** e **Production Files**. O mockup é a prova que o cliente vê e aprova e pode ir no PDF. O arquivo de produção é interno, de qualquer formato, fica fora da aprovação e nunca vai ao cliente. O cartão do job mostra os dois selos. |
| [Printavo](https://support.printavo.com/hc/en-us/articles/46723954699035-Artwork) | O mockup aparece na fatura pública do cliente. Os arquivos de produção (separações, AI, bordado) só a equipe vê. |
| [shopVOX](https://help.shopvox.com/article/npcxy1n4u6-uploading-and-sending-proofs-for-approval) | A prova tem versão (V1, V2…), carimbo de aprovação e registro de quando o cliente abriu. Só a prova aprovada segue para a produção. |
| Holdprint (`docs/plano-interface-holdprint-31-10-2026.md`) | Tem a etapa "Arte Final" entre Programação e Impressão. O Terminal de Produção (7b) ainda falta aqui. |

## O que entrou (este PR)

1. **Regra única**, em `separarArquivos`, `src/domain/os/arquivos-da-os.ts`:
   - **Arquivo de impressão**: marcado como final de produção, ou tipo
     `producao`. Mesmo nome no mesmo item é versão: vale a mais nova, e as outras
     ficam em "versões anteriores — não imprimir".
   - **Mockup**: tipo `arte` ou `referencia`, o aprovado primeiro.
   - **Anexo**: o resto.
   - Um arquivo pode ser as duas coisas (a imagem aprovada que se imprime).
2. **Baixar de verdade** (`src/lib/baixar-arquivo.ts`,
   `components/arquivos/botoes-do-arquivo.tsx`):
   - A URL assinada vai com `download: <nome>`, então o arquivo chega com o nome
     legível, em qualquer formato.
   - Usa o bucket da linha.
   - Falha vira aviso.
3. **Ficha do quadro**, em três partes:
   - **Arquivo de impressão** em cima, com "Baixar".
   - **Mockup**, com a situação da aprovação.
   - **Outros anexos** recolhidos.
   - O anexar diz o que sobe: "Anexar arquivo de impressão" (tipo `producao`, já
     final; mesmo nome vira nova versão) ou "Anexar mockup" (tipo `arte`).
4. **OS › Arquivos**:
   - "Baixar" de verdade.
   - O tipo é gravado, em palavras: "Mockup / arte" e "Arquivo de impressão".
   - "Marcar como final" conferido.
   - Nome seguro no Storage.
   - Coluna "Para quê" (Impressão / Mockup / Anexo).
5. **Minha oficina**: cada OS da fila traz "Baixar arquivo (PDF)", um botão por
   arquivo de impressão.

## Depois do PR #466 (mesmo dia, PR seguinte)

Entraram:

- **PDF de produção.** A imagem do item passou a ser o arquivo de impressão (final
  de produção, quando é imagem), não o mockup do orçamento.
- **Selo no cartão do quadro.** "Mockup ✓ · Impressão —", com ícone e palavra, da
  criação até a máquina.
- **Conferência de resolução (preflight simples).** A ficha mede a imagem de
  impressão e confere a resolução no tamanho da peça.
- **Arquivos da OS 174.** As versões 1 e 2 foram marcadas como substituídas pela 3,
  com o OK do dono e registro em `logs_auditoria`.

Continua em aberto:

- **Arquivo de impressão só depois da aprovação**, como faz o shopVOX. Pede decisão
  do dono.
- **Preflight completo:** sangria, cor e PDF vetorial. Hoje só a resolução de imagem
  é conferida.

O aval do gestor, a escolha do operador e o saldo devedor estão em
`docs/atendimento-validado-operador-e-saldo-devedor-14-11-2026.md`.
