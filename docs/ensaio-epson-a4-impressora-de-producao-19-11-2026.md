# A Epson EcoTank A4 vira impressora de produção (19/11/2026)

Migração: `supabase/migrations/20261119210000_epson_a4_impressora_de_producao.sql`.

## O que estava errado

A "Epson EcoTank L3250 (A4)" está ativa, com o tipo em texto livre **"Impressão jato de tinta A4"**. Esse tipo não
existe em `tipos_de_maquina()`, o vocabulário que a produção usa. Dois efeitos:

- **Ninguém começava nem punha fila nela.** `comecar_na_maquina` e `definir_maquina_da_os` recusavam:
  "a máquina é de um tipo que ainda não tem etapa de produção no sistema".
- **A TV da Oficina acusava erro.** A conferência R6 (`maquinas_ativas_demais`) contava 6 colunas numa parede
  desenhada para 5.

## Por que não dava para desativar

Era a outra saída que o dono podia escolher. Conferi no banco antes de decidir:

- A Epson é a **máquina padrão do produto ativo "Certificado A4 papel texturizado vergê 180g"**.
- A **OS 232**, que leva esse produto, tem a reserva dela na agenda (13/11, agendada).

Desativar deixaria essa OS sem máquina e tiraria a sugestão do produto. A máquina é real e está em uso. Faltava o
cadastro dizer o que ela é.

## O que mudou

1. **`tipos_de_maquina()` ganha `impressora_a4`**, na mesma etapa da plotter (`em_impressao`, etapa "Impressão").
   As ordens passam a ir de 1 a 6, com a Epson logo depois da plotter nas listas de máquina. Nenhuma tabela guarda
   `ordem`.
2. **O tipo da plotter não foi reaproveitado.** A tela de importar Flexi lista as máquinas de `plotter_impressao`,
   e a Epson não é Flexi.
3. **A Epson passa para `impressora_a4`.** O texto antigo fica em `especificacoes.tipo_anterior`, e fica um rastro
   `tipo_da_maquina_corrigido`.
4. **A TV agrupa as duas impressoras numa coluna só**, como já agrupava as 3D:
   - a R6 do banco conta as máquinas de `em_impressao` como uma coluna (e as de `em_3d`, como já contava);
   - a parede faz o mesmo (`organizarParede`, `GRUPO_DA_PAREDE`): as duas máquinas ficam na mesma coluna. **A
     plotter mantém a coluna inteira**, com a lista "DEPOIS", e a **Epson A4 ganha um cartão compacto no pé dela**
     (nome, fila, estado e o que está rodando). A página da fila da plotter encurta em duas linhas para o cartão
     caber (`trabalhosPorPaginaComAcoplados`);
   - a legenda do quadro continua com cinco itens, e o limite de colunas continua 5.

## O que muda de comportamento

Com duas impressoras na etapa, o status `em_impressao` **deixa de identificar uma máquina só**, como `em_laser_cnc`
com os dois lasers.

- **Aparece em "sem máquina" na TV** uma OS em `em_impressao` que não tenha *nenhum* destes: máquina gravada na OS,
  apontamento aberto, reserva, máquina padrão do produto. Antes, ela era posta na plotter por palpite.
- **Em 19/11/2026 nenhuma OS estava em `em_impressao`.** As que têm máquina gravada, apontamento, reserva ou
  máquina padrão (a Plotter nas lonas e adesivos, a Epson no certificado) continuam onde estavam.
- **O cartão no quadro** de uma OS em `em_impressao` sem máquina continua dizendo "Impressão", com a mesma cor e o
  mesmo ícone, mas já não diz que é a plotter.
- **Correção de desenho, 20/11/2026.** A primeira versão publicada em 19/11 punha a plotter e a Epson como dois cartões
  iguais dentro de uma coluna, como as Bambu. Fotografei a tela de demonstração e a plotter, a máquina mais ocupada
  da oficina, perdia a lista "DEPOIS" (onde aparecem as OS atrasadas), o prazo "HOJE" e o nome do produto, e a Epson
  ocupava um cartão grande quase vazio. A coluna da plotter voltou a ser inteira, com a Epson acoplada no pé. Para
  olhar sem estar na oficina: `/tv/maquinas?demo=impressoras`.

  **Medido no site publicado** (Playwright, 1920x1080, `?demo=impressoras`): 5 colunas; coluna da plotter com 641 px;
  cartão acoplado da Epson dentro dela, com 76 px de cartão e 91 px de bloco; lista "DEPOIS" com 3 linhas por
  página (171 px numa janela de 196 px); nenhuma linha cortada, nada estourando, nenhuma faixa de número
  inconsistente. Acabamento depois da medida: o bloco passou a 95 px (mais respiro para os pontinhos da paginação) e a
  fila zerada do cartão acoplado diz "sem fila", não "vazia".

## Ensaio no banco vivo (19/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o `COMMIT`, com uma fotografia da TV antes e outra depois (como `service_role`), e a
tentativa de começar a OS 233 na Epson como o operador Fernando.

| O que se olhou | Antes | Depois |
| --- | --- | --- |
| Falhas da TV | R6, `maquinas_ativas_demais`: obtido 6, esperado 5 | nenhuma |
| Máquinas na TV | 9 | 9 |
| Máquinas, blocos, cartões e saídas | — | iguais aos de antes (só `ordem` e `tipo` mudam) |
| Seletor de máquina, linha da Epson | sem etapa, não pode começar | destino `em_impressao`, pode começar |
| Começar a OS 233 na Epson | recusado: "tipo (Impressão jato de tinta A4) que ainda não tem etapa de produção" | começou: OS 233 de `em_producao` para `em_impressao` |
| Custo cheio do Certificado A4 | — | igual |
| `maquina_do_status('em_impressao')` | plotter_impressao | nulo (ambíguo, de propósito) |

A ordem do seletor depois da migração: Plotter de Impressão (1), Epson (2), Plotter de Recorte (3), CNC Laser CO2
(4), Fiber (5), as quatro Bambu (6).

O md5 dos corpos depois da troca ficou fixado na conferência final da migração: `tipos_de_maquina` =
`b720ff2751c005fca3dda9dac304f81a`, `tv_painel_maquinas` = `3dedfd97cef70d65d02d364d90c09df4`. A migração para se o
corpo vivo de antes não for o lido (`7f0504c3…` e `0b4c9dc0…`) ou se a Epson não estiver com o tipo esperado.

**Depois do ensaio, conferido no banco:** tipo da Epson como antes, md5 originais das duas funções, 5 tipos, nenhum
rastro, OS 233 em `em_producao` e sem máquina, nenhum apontamento na Epson.

## Aplicação

Aplicada pelo Claude Code com a autorização do dono para a Bex Print, depois do ensaio e do CI verde. A tela da TV
precisa ser publicada para a parede agrupar as impressoras; a conferência depois da aplicação está no PR.
