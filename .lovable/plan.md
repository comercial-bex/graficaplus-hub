# Instalação ligada ao item que ela instala

## O que muda para o vendedor
1. Ao lançar ou editar um item de instalação, aparece o campo **"Instala qual item?"** com os itens de produto do orçamento. Se só houver um, ele já vem marcado. Quando o vendedor escolhe, a descrição vira "Instalação do adesivo perfurado (one way)". Ele pode editar esse texto depois, e trocar de item não apaga o texto que ele editou.
2. Enquanto houver instalação sem item escolhido, a revisão mostra a pendência **"instalação sem item de origem"**. O botão leva ao passo 2, abre o item e põe o foco no campo novo. A pendência some assim que o vínculo é feito. Arte, frete e outros serviços não geram essa pendência.
3. No passo 3, o campo **Acabamento** ("Refile, ilhós…") fica escondido nos itens de serviço. Nos itens físicos nada muda.
4. No passo 3 dos serviços entra uma linha curta: "Especificações e artes ficam no próximo passo", com um link que pula para o passo 4. O bloco de detalhes não é repetido.

## Respostas às perguntas

**Onde guardar o vínculo: no campo existente `parametros` (sem migração).**
- O item já tem `parametros jsonb NOT NULL default '{}'`. A instalação grava `parametros.instala_item_id = <id do item de origem>`, mais `instala_descricao_auto = true/false`, que diz se o texto ainda é o automático.
- Por que não criar uma coluna agora: uma coluna `item_origem_id` com chave estrangeira daria integridade no banco, mas exigiria migração, tipos novos e revisão das funções de duplicar e converter. Fica como evolução se a equipe quiser relatórios por vínculo.
- **RLS e views financeiras:** não mudam. Uma chave dentro de `parametros` não afeta políticas nem as views do `fromFinancialView`, que não leem esse campo.
- **Orçamentos antigos, enviados e aprovados:** a pendência só é calculada quando o orçamento ainda pode ser editado (rascunho ou enviado e não convertido). Ela nunca aparece em orçamentos aprovados, convertidos ou fechados. Rascunhos antigos com instalação passam a mostrar a pendência, o que é o comportamento esperado. Nenhum dado é alterado em massa.

**Como reconhecer um item de instalação** (regra pura `ehItemDeInstalacao` em `src/domain/orcamentos/instalacao.ts`):
- **Item com produto do catálogo:** quem decide é o produto, nunca o texto. É instalação só quando o tipo é "servico", a categoria do produto é `instalacao` e a unidade é hora ("h"). Assim, "Instalação em campo" (h) é instalação e "Deslocamento" (km) não é.
- **Item livre, sem produto:** é instalação quando a descrição começa com "Instalação" e a unidade é hora.
- Todo o resto fica sem o campo de vínculo e sem a pendência: Deslocamento, Criação/arte final, serviços por unidade e frete.

**Se o item de origem for excluído:** o vínculo aponta para um id que não existe mais, a regra trata a instalação como "sem origem" e a pendência volta. Antes de excluir, o sistema avisa: "Este item tem uma instalação ligada; ela ficará pendente."
**Se o item de origem for duplicado:** a cópia não leva nenhuma instalação junto, e a instalação continua ligada ao item original.
**Se a própria instalação for duplicada:** a cópia mantém o mesmo vínculo, o que serve para duas instalações do mesmo item.
**Se o orçamento for duplicado:** hoje o sistema não tem a função de duplicar um orçamento inteiro. Conferi isso nas telas e no banco: só existe duplicar item. Por isso não há nada a ajustar e **nenhuma migração é necessária**. Se essa função for criada um dia, a cópia deve refazer o vínculo ou deixar a instalação pendente; a regra já trata o vínculo quebrado como pendência.
**Se o orçamento for convertido em OS:** a conversão não usa o vínculo, e a OS recebe a descrição em texto ("Instalação do adesivo perfurado"), que já é o que a produção lê. Antes de implementar, confiro se a conversão copia `parametros`. Se copiar, a informação vai junto e não causa nenhum efeito.

**PDF (`DocumentoPDF.tsx`):** só muda o texto, porque ele já imprime a descrição. Não entra nenhum campo novo.
**Parceiro (`editor-de-orcamento.tsx`):** fica de fora nesta etapa. O parceiro não lança o serviço de instalação da gráfica, e as pendências dele não usam `pendenciasParaEnviar`.

## Arquivos
- `src/domain/orcamentos/instalacao.ts` (novo): `ehItemDeInstalacao`, `instalacoesSemOrigem`, `descricaoDaInstalacao(nomeDoItem)`, `origemPadrao(itensDeProduto)`.
- `src/domain/orcamentos/acordo.ts`: nova constante `PENDENCIA_INSTALACAO_SEM_ORIGEM` e uma entrada opcional `instalacoesSemOrigem?: string[]` em `pendenciasParaEnviar`.
- `src/domain/orcamentos/passos-da-equipe.ts`: `passoDaPendencia` manda a pendência nova para o passo 2.
- `src/routes/_authenticated/orcamentos.$id.tsx`: o campo de vínculo no passo 3 da instalação, gravação em `parametros`, esconder o acabamento quando o item é serviço, aviso e atalho para o passo 4, aviso ao excluir e foco no campo quando o vendedor vem da pendência.
- `src/components/orcamento/vinculo-da-instalacao.tsx` (novo): a lista de seleção, usando só tokens de cor.
- `src/lib/dicas.ts`: dica do campo "Instala qual item?" e o texto do atalho para o passo 4.
- Banco de dados: nenhuma mudança. Se, durante a implementação, aparecer algo que exija migração, eu paro, mostro o SQL e espero a decisão da equipe.

## Testes (em `tests/`)
- `instalacao-vinculo.test.ts`:
  - instalação sem vínculo gera a pendência;
  - com vínculo válido, a pendência some;
  - vínculo para um item excluído volta a gerar a pendência;
  - "Instalação em campo" (catálogo, instalacao, h) sem vínculo gera a pendência;
  - "Deslocamento" (catálogo, instalacao, km) nunca gera a pendência nem recebe o campo;
  - "Criação/arte final" (catálogo, servico, h) nunca gera;
  - item livre "Instalação ..." em hora gera; item livre "Instalação ..." em un não gera;
  - item com produto e descrição "Instalação ..", mas produto que não é de instalação: o catálogo manda e não gera;
  - `passoDaPendencia` leva ao passo 2.
- `instalacao-descricao.test.ts`:
  - "Adesivo perfurado (one way)" vira "Instalação do adesivo perfurado (one way)";
  - com um único item de produto, ele é pré-selecionado; com dois, nenhum é;
  - a descrição editada pelo vendedor não é sobrescrita.

## Riscos e o que fica de fora
- **Riscos:**
  - Se alguém cadastrar outro serviço de instalação por hora com categoria diferente de `instalacao`, ele não será reconhecido. A correção é ajustar a categoria no catálogo.
  - Um item livre de instalação escrito de outro jeito (por exemplo "Aplicação") também não é reconhecido. É aceitável, porque o caminho normal é usar o produto do catálogo.
  - Sem chave estrangeira, o banco não garante o vínculo. A regra trata vínculos quebrados como pendência.
- **Fica de fora:**
  - coluna nova e chave estrangeira;
  - calcular as horas de instalação pela área do adesivo;
  - mostrar o vínculo no PDF ou na OS além do texto;
  - parceiro e vendas diretas;
  - qualquer mudança em `ferramentas/`.
