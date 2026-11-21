# Plano para chegar aos 100 (21/11/2026)

Ponto de partida: nota **68 de 100**, medida em 20/11/2026 (diagnóstico completo, conversa de 20 e 21/11). A cabeça do
sistema é boa (banco, custos, segurança, mensagens: 90). O corpo ainda não obedece à cabeça: quadro, chão de fábrica e
TV (40 a 55), funil de vendas (72) e recursos prontos que ninguém usa (45).

Regra do dono para o plano: **nenhum PDF é reenviado ao cliente por nós**. Quem autoriza reenvio é o gerente. Onde um
ajuste de orçamento pede reenvio, o sistema só **avisa o gerente no grupo**.

"Pronto" aqui é o do projeto: dado real, e alguém viu o dado. Cada frente tem um número para olhar, e a lista de
consultas está no fim.

## O que já foi feito (20 e 21/11)

| O quê | Resultado |
| --- | --- |
| Login do Yvens banido (como o do Léo), cadastro de parceiro suspenso | Reversível: `banned_until` nulo e status `ativo` |
| Número do Léo e do Yvens: bloqueio conferido | Achado: o bloqueio só barrava a entrada de 2 das 3 filas. A fila de **automações** manda direto para o telefone do payload e **continuou mandando "Olá, Leonardo!" às 09:00 de 18, 19, 20 e 21/11** (4 envios, medido em `whatsapp_logs`) |
| Automação "Lembrete à operação" apontada para o gerente | Deixou de ir para o Léo. O texto agora é "Olá, Raymison!". Se o dono preferir outra pessoa, troca-se `payload.telefone` e `payload.mensagem` |
| Última porta no código: o envio confere o bloqueio nas 3 filas antes de chamar o Z-API | Neste PR. Depende de **publicar o front** |
| Aviso ao gerente no grupo: valores dos orçamentos #261, #187, #227, #233, #115 | Enviado 21/11 09:40, sem reenviar PDF nenhum |
| Cobrança no grupo: Fernando, Raymison e Maiara resolvem os 21 cartões do quadro | Enviado 21/11 09:40 |
| Aviso do funil no grupo: 25 orçamentos sem resposta há mais de 7 dias (R$ 5.188,56), leads parados | Enviado 21/11 09:40 |
| Acabamento à parte opcional no orçamento (PR #503) | Publicado |
| TV: cartão da Epson e plotter inteira (PRs #500 a #502) | Publicado e medido no site |

## Frente 1. Fechar o laço do chão

O problema: o quadro mostra o que alguém clicou, não o que a máquina faz. De 14 a 20/11 foram 79 mudanças de etapa e
**0 apontamentos de máquina** (o último é de 10/11). Quem mexe nos cartões é o gerente; o operador não usa o "Começar na
máquina".

- **Feito neste PR:** o aviso diário da equipe ganha um bloco "Em produção, mas ninguém começou numa máquina", com o
  que o botão "Começar na máquina" resolve. Fica de fora a OS com máquina, a com apontamento aberto e a de impressão 3D
  (que anda por `producao_3d_jobs`: as OS 233 e 237 são assim). Hoje o bloco pega a OS #235.
- **Gente:** o Fernando começa na máquina pelo modal de cada OS, e o gerente deixa de arrastar o cartão para "Em
  produção" sozinho.
- **TV:** o único aparelho pareado não consulta o painel desde 16/11 (segunda). A página funciona (9 máquinas, sem
  falha de conferência). Falta ligar o aparelho em `/tv`, ou parear de novo pelo PIN em Configurações.
- **Pronto quando:** toda OS de venda que passa por "Em produção" tem apontamento com máquina; a TV tem um aparelho
  visto nos últimos 5 minutos em horário de expediente.

## Frente 2. Limpar o quadro (sem apagar em lote)

São 21 cartões em quatro colunas: 8 em Entrada, 6 em Aguardando retirada, 4 em Em entrega, 3 em Arte aprovada. 20 estão
com o prazo vencido e 14 foram criados em outubro. Os outros 7 são de novembro.

- **Feito:** cobrança no grupo, com a lista por coluna e a regra de decisão: entregue, conclui; desistiu ou não vai
  retirar, cancela com motivo; falta algo, põe na etapa certa e avisa o cliente.
- **Atenção:** os 4 cartões do Yvens (#170 a #173, R$ 685,40 pendentes) estão com mensagens automáticas bloqueadas pela
  direção. Só por ligação.
- **Gente:** Fernando, Raymison (gerente) e Maiara.
- **Pronto quando:** nenhuma OS aberta passa de 7 dias na mesma etapa sem anotação, e nenhuma está com prazo vencido sem
  nova data combinada.

## Frente 3. Destravar o funil

- 25 orçamentos enviados há mais de 7 dias sem resposta (R$ 5.188,56): 13 da Jhesselem, 5 da Maiara, 2 do Raymison, 1
  do Fernando e **4 sem dono** (o vendedor, o Léo, está inativo: #115, #168, #82, #107, R$ 795,04). O #157 é teste de
  parceiro e pode ser rejeitado.
- 128 leads "em atendimento", 43 deles sem movimento há mais de 14 dias, e 10 leads novos há mais de 3 dias (o mais
  antigo é de 06/10).
- **Feito:** aviso no grupo com a lista por vendedor. O sistema não reenvia nada sozinho.
- **Gente:** cada vendedora liga ou escreve e marca como rejeitado quem desistiu. O Raymison redistribui ou rejeita os 4
  sem dono.
- **Carteira do Léo e do Yvens (decisão do dono):** o Léo tem 28 orçamentos, 9 OS, 6 clientes e 2 leads abertos no
  nome; o Yvens, 6 orçamentos e 3 OS. Nada foi trocado de dono sem decisão. Cadastro **não se apaga**: eles aparecem em
  94 mensagens enviadas, 28 orçamentos e 9 OS (chaves estrangeiras).
- **Pronto quando:** 0 orçamento enviado há mais de 7 dias sem ação registrada; 0 lead novo há mais de 1 dia sem
  atendimento.

## Frente 4. Valores dos orçamentos que mudaram depois do envio

Conferido em 21/11 com o histórico de versões e de envio. **Nenhum PDF foi reenviado por nós.**

| Orçamento | Enviado | Hoje | O que explica | Quem decide |
| --- | --- | --- | --- | --- |
| #261 Michely | R$ 1.283,91 (19/11) | R$ 1.149,70 | 6 peças de 1,20 × 2,00 m viraram 1,00 × 2,00 m. A conta com os 20% de desconto fecha (1.437,13 − 287,43). PIX e PDF novos saíram hoje, 09:28 e 09:32, pela equipe | Gerente: confirmar a medida |
| #187 Gessyka | PDF de 06/11 | R$ 90,98 (19% de R$ 112,32) | O PDF foi feito antes da correção do desconto e pode ter mostrado R$ 112,32. Não há registro de envio pelo sistema | Gerente: confirmar o valor combinado |
| #227 Almir | R$ 57,60 (13/11) | R$ 448,00 | 0,80 × 0,80 m virou 8,00 × 0,80 m a R$ 70/m². 3 PDFs novos em 13 e 14/11; o orçamento foi mexido 2 min depois do último | Gerente: confirmar o valor aceito |
| #233 Odilon | R$ 45,76 (14/11) | R$ 148,16 | m² de R$ 55 para R$ 69,90 e arte de R$ 90. PDF novo enviado em 16/11 17:43, já com o valor de hoje | Nada a fazer |
| #115 Yvens | R$ 530,30 (23/10) | R$ 366,00 | Mexido em 09/11, sem reenvio. Orçamento com mais de 4 semanas | Gerente: rejeitar ou expirar |

## Frente 5. Higiene menor

- **Feito:** login do Yvens banido; número bloqueado conferido nas 3 filas (este PR); AGENTS.md corrigido (a trava de
  status do orçamento **já está aplicada**: `tg_orcamento_transicao_de_status` existe no banco).
- **Neste PR (migração 20261121120000):** o aviso aos gestores passa a ignorar quem está inativo (era a única rotina que
  não respeitava `usuarios.ativo`; hoje o único gestor está ativo e ninguém foi atingido).
- **Decisões do dono, sem mudança feita:**
  - Comissão: a regra de 10% existe só para o **Raymison**. A Jhesselem (14 OS) e a Maiara (7 OS) não têm regra, então
    nunca geram comissão. A tabela de comissões tem 0 linhas.
  - Quem recebe o "Lembrete à operação": hoje o gerente. Pode ser o Fernando.
  - O papel vendedor do único gestor ativo (item antigo do roadmap).
- **Função antiga sem uso:** `supabase/functions/process-automations` (ninguém a chama desde 06/10). Não foi apagada.
  Provar antes: sem rota, sem cron, sem invocação em log.

## Recursos prontos com a tabela vazia (instalados, não prontos)

Fila do gestor (`os_pedidos_ao_gestor`), checklists de OS, pós-venda (tickets, garantias, retornos), portal do cliente,
catálogo público, reembolsos, comissões, campanhas e ofertas de parceiros, manutenção de máquinas, inventário de
estoque. Para cada um: **ligar com dono e data**, ou tirar do menu. Nada disso muda hoje.

## Placar e meta

| Área | 20/11 | Meta | Como medir |
| --- | --- | --- | --- |
| Cérebro e cofre (banco, segurança) | 92 | 95 | `seguranca_funcoes_anon`, tabelas sem RLS = 0 |
| Coração (mensagens, rotinas) | 90 | 97 | 0 envios a número bloqueado; 0 conversa esperando há mais de 4 h |
| Bolso (financeiro) | 80 | 90 | parcelas vencidas tratadas; saldo do C6; 3 parcelas sem data |
| Apetite e digestão (vendas) | 72 | 90 | 0 orçamento sem ação há mais de 7 dias |
| Braços e mãos (quadro) | 55 | 90 | 0 OS aberta parada há mais de 7 dias |
| Olhos (TV, máquinas) | 40 | 90 | TV vista nos últimos 5 min; apontamentos por dia útil |
| Hábitos (recursos usados) | 45 | 80 | cada recurso vazio: ligado ou fora do menu |

## Consultas para medir toda semana (somente leitura)

```sql
-- quadro: abertas, vencidas e paradas há mais de 7 dias na mesma etapa
select count(*) abertas,
       count(*) filter (where prazo_entrega < current_date) vencidas,
       count(*) filter (where updated_at < now() - interval '7 days') paradas_7d
from ordens_servico where status::text not in ('concluido','faturado','cancelado');

-- chão: apontamentos de máquina por dia nos últimos 14 dias
select iniciado_em::date dia, count(*) from apontamentos_producao
where iniciado_em > now() - interval '14 days' group by 1 order by 1;

-- TV: o último aparelho visto
select nome, ultimo_acesso_em, now() - ultimo_acesso_em ha from tv_dispositivos where revogado_em is null;

-- funil: orçamentos enviados sem resposta há mais de 7 dias e leads parados
select count(*) from orcamentos where status::text = 'enviado' and coalesce(enviado_em, created_at) < now() - interval '7 days';
select count(*) filter (where status::text = 'novo' and created_at < now() - interval '1 day') novos_parados,
       count(*) filter (where status::text = 'em_atendimento' and updated_at < now() - interval '14 days') atendimento_parado
from leads;

-- mensagens: envios depois do bloqueio (precisa dar 0 depois de publicar este PR)
select count(*) from whatsapp_logs l
where l.created_at > '2026-11-17 23:29:47+00' and l.sucesso
  and right(regexp_replace(coalesce(l.request->>'para', l.request->>'phone', ''), '\D', '', 'g'), 8)
      in (select right(chave, 8) from whatsapp_numeros_bloqueados);

-- higiene: inativo com login livre
select count(*) from usuarios u join auth.users a on a.id = u.id
where not u.ativo and (a.banned_until is null or a.banned_until < now());
```

## Ordem de execução

1. **Hoje (feito):** login do Yvens, automação do Léo, três avisos no grupo.
2. **Hoje (este PR):** última porta do bloqueio, higiene dos lembretes e bloco do laço do chão. Depois do merge:
   aplicar a migração (ensaiada, md5 fixado), publicar o front e medir a consulta de envios a número bloqueado.
3. **Segunda, 23/11:** conferir o aviso das 09:00 (quem recebeu o "Lembrete à operação", se o bloco do laço do chão
   apareceu) e o quadro depois do mutirão do fim de semana.
4. **Esta semana:** TV de volta à parede; Fernando começando na máquina; funil respondido.
5. **Em duas semanas:** decisões do dono (comissão, carteira do Léo e do Yvens, recursos vazios) e nova medição da nota.
