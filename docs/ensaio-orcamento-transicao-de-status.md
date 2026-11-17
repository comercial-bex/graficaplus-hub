# Ensaio da migração: trava de transição de status do orçamento

Migração: `supabase/migrations/20261117230000_orcamento_transicao_de_status.sql`. Estado: **NÃO aplicada e NÃO ensaiada ainda: o script abaixo é para o dono rodar. Ele roda a migração dentro de uma transação, testa as transições e termina em RAISE EXCEPTION, que desfaz tudo.** Teste de contrato: `tests/orcamento-transicao-de-status-migracao.test.ts`.

## Tabela das transições permitidas

| De | Para | Quem faz |
| --- | --- | --- |
| rascunho | enviado | `confirmar_envio_documento`, `registrar_envio_documento` (wa.me e link), contingência de `documento-whatsapp.functions.ts` |
| enviado | aprovado | `aprovar_orcamento`, `responder_orcamento_publico` (cliente aprovou) |
| enviado | rejeitado | `responder_orcamento_publico` (cliente recusou), AcoesDoStatus |
| enviado | expirado | AcoesDoStatus |
| expirado | enviado | `renovar_orcamento_vencido`, `api_executar` renovar_orcamento |
| aprovado | convertido | nenhum caminho grava hoje; reservado para a conversão em OS |
| mesmo status | mesmo status | passa sempre: renovar enviado vencido, regravação sem mudança |

Não existe função de reabrir no banco vivo (lido em 17/11/2026). Tudo fora da tabela dá erro `OR001`, DETAIL `transicao_invalida`.

## Todos os escritores de status, lidos no banco vivo e no código

Busca no banco vivo: toda função, em qualquer esquema, com UPDATE em `orcamentos` cujo SET tenha `status =` (23 funções tocam em orcamentos; sete mexem em status), mais EXECUTE dinâmico com `orcamentos` (nenhum), mais cron (`cron.job`: só `lembrete_orcamentos_aprovados_sem_os` e `alerta_integridade_orcamentos`, que só leem) e `supabase/functions` (só `process-automations`, sem escrita em orçamento). No código, busca por `.update(` com `status` nas telas e funções de servidor.

| Escritor | Transição que faz | Prova | Barrado? |
| --- | --- | --- | --- |
| `aprovar_orcamento` | enviado para aprovado (a 190000 recusa qualquer outra origem; aprovado devolve `ja_aprovado` sem UPDATE) | corpo vivo: `SET status='aprovado'` depois de `IF v_orc.status::text <> 'enviado'` | não |
| `responder_orcamento_publico` | enviado para aprovado ou rejeitado (`WHERE status::text = 'enviado'`) | corpo vivo | não |
| `renovar_orcamento_vencido` | expirado ou enviado vencido para enviado | corpo vivo; recusa `ainda_valido` e `nunca_enviado` | não |
| `api_executar` renovar_orcamento (UPDATE direto) | expirado ou enviado vencido para enviado (`IF NOT (v_status = 'expirado' OR (v_status = 'enviado' AND v_vencido))` sai antes) | corpo vivo | não |
| `confirmar_envio_documento` | rascunho para enviado (`IF v_status = 'rascunho'`) | corpo vivo | não |
| `registrar_envio_documento` (wa.me) | rascunho para enviado (`IF v_status = 'rascunho'`) | corpo vivo | não |
| contingência em `src/lib/api/documento-whatsapp.functions.ts` | rascunho para enviado (`.eq("status","rascunho")`) | código | não |
| `AcoesDoStatus` (`src/components/orcamento/acoes-do-status.tsx`) rejeitar e expirar | enviado para rejeitado ou expirado (`.eq("status","enviado")`) | código | não |
| `sync_orcamento_3d_para_funil` | copiava o status do 3D por cima do orçamento, em qualquer direção | corpo vivo | **sim, por isso a migração troca a função**: só grava o status quando a transição é permitida, senão mantém |
| `converter_orcamento_em_os`, `converter_orcamento_3d_em_os` | não gravam status do orçamento (só `os_id`); o 3D vai a `convertido` na tabela `orcamentos_3d`, que não tem esta trava | corpo vivo | não se aplica |
| `tg_parceiro_pedido_recusado`, `parceiro_enviar_pedido`, `parceiro_venda_direta`, `catalogo_adicionar_ao_orcamento`, `definir_desconto_do_orcamento` | só atualizam outras colunas; `parceiro_enviar_pedido` e a sync fazem INSERT, e a trava é só de UPDATE | corpo vivo | não se aplica |
| IA e assistente (`orcamento-ia.functions.ts`, `whatsapp-assistente.server.ts`) | INSERT de rascunho e leitura; nenhum UPDATE de status | código | não se aplica |

## Achados que o dono precisa saber

1. **A sync do 3D era a única escritora fora da tabela.** `trg_sync_orcamento_3d_funil` dispara ao editar título, cliente, status, preço ou contato de um orçamento 3D que não é embutido, e gravava o status do 3D no orçamento do funil. Hoje os 31 orçamentos 3D são todos embutidos (a função sai na primeira linha), então nada se perde agora, mas um 3D novo e não embutido em rascunho puxaria um orçamento enviado ou aprovado de volta a rascunho. Sem a troca, esse caso daria erro `OR001` na tela do 3D. Com a troca, o status do funil é mantido.
2. **Consequência da troca para a conversão do 3D.** Se um 3D não embutido for convertido em OS com o orçamento do funil ainda em enviado, o orçamento não vira convertido (enviado para convertido não está na tabela). Hoje nenhum caminho do funil marca convertido, e 22 orçamentos com OS continuam aprovados. **Proposta, se o dono quiser que a conversão feche o orçamento: ampliar a tabela com aprovado para convertido já existente mais enviado para convertido, ou fazer `converter_orcamento_em_os` gravar convertido depois de aprovar.** Não ampliei sem pedido.
3. **Correção manual de status** (por exemplo desfazer uma aprovação errada) passa a exigir `ALTER TABLE public.orcamentos DISABLE TRIGGER tg_orcamento_transicao_de_status`, corrigir e `ENABLE` na mesma sessão.
4. Os UPDATEs acima têm outros gatilhos no caminho (`zz_orcamento_congela_versao`, `tg_orcamento_notificar_cliente`, `tg_parceiro_pedido_recusado`). O gatilho novo roda antes deles (ordem alfabética dos BEFORE) e não mexe neles.

## Script do ensaio

Cole inteiro de uma vez. O banco vivo desfaz tudo no RAISE EXCEPTION final. A mensagem do erro é o relatório. Nota: sequências (numeração) podem avançar mesmo com o desfazer, como em todos os ensaios anteriores.

O que o resultado deve mostrar: `[1] 36 combinacoes testadas, falhas=0`; `[2] ... ok`; `[3] ... ficou enviado`; `[4] gatilho presente=true`, `corpo da sync com o CASE=true`, `anon executa gatilho=false authenticated executa gatilho=false anon executa tabela=false authenticated executa tabela=false service_role executa gatilho=true`. Qualquer linha `FALHOU` aparece com o estado esperado e o obtido (um SQLSTATE diferente de OR001 numa transição permitida seria outro gatilho recusando, e não esta trava).

```sql
BEGIN;

DO $guarda$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.sync_orcamento_3d_para_funil()'::regprocedure)
       IS DISTINCT FROM '45167125eda9df1a95c9ab0cefa8e28a' THEN
    RAISE EXCEPTION 'sync_orcamento_3d_para_funil mudou desde o ensaio: reler o corpo vivo antes de trocar.' USING ERRCODE = '55000';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.orcamento_transicao_permitida(p_de text, p_para text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT p_de IS NOT DISTINCT FROM p_para
      OR (p_de, p_para) IN (
           ('rascunho', 'enviado'),
           ('enviado',  'aprovado'),
           ('enviado',  'rejeitado'),
           ('enviado',  'expirado'),
           ('expirado', 'enviado'),
           ('aprovado', 'convertido')
         );
$f$;

REVOKE ALL ON FUNCTION public.orcamento_transicao_permitida(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_transicao_permitida(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_orcamento_transicao_de_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.orcamento_transicao_permitida(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'Este orçamento não pode mudar de % para %.', OLD.status::text, NEW.status::text
      USING ERRCODE = 'OR001',
            DETAIL = 'transicao_invalida',
            HINT = 'Rascunho vai para enviado. Enviado vai para aprovado, rejeitado ou expirado. Expirado volta para enviado ao renovar. Aprovado vai para convertido.';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_orcamento_transicao_de_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_orcamento_transicao_de_status() TO service_role;

DROP TRIGGER IF EXISTS tg_orcamento_transicao_de_status ON public.orcamentos;
CREATE TRIGGER tg_orcamento_transicao_de_status
  BEFORE UPDATE OF status ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_transicao_de_status();

CREATE OR REPLACE FUNCTION public.sync_orcamento_3d_para_funil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_orc_id uuid; v_status public.status_orcamento;
BEGIN
  IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;

  v_status := CASE lower(coalesce(NEW.status,'rascunho'))
    WHEN 'enviado' THEN 'enviado'::public.status_orcamento
    WHEN 'aprovado' THEN 'aprovado'::public.status_orcamento
    WHEN 'rejeitado' THEN 'rejeitado'::public.status_orcamento
    WHEN 'convertido' THEN 'convertido'::public.status_orcamento
    WHEN 'expirado' THEN 'expirado'::public.status_orcamento
    ELSE 'rascunho'::public.status_orcamento END;

  IF NEW.orcamento_id IS NULL THEN
    INSERT INTO public.orcamentos (cliente_id, titulo, descricao, status, valor_subtotal, valor_total,
                                   contato_nome, contato_telefone, contato_email, created_by, os_id, prazo)
    VALUES (NEW.cliente_id, NEW.titulo, coalesce(NEW.descricao,'Orçamento de impressão 3D'), v_status,
            coalesce(NEW.preco_comercial,0), coalesce(NEW.preco_comercial,0),
            NEW.contato_nome, NEW.contato_telefone, NEW.contato_email, NEW.created_by, NEW.os_id, NEW.prazo)
    RETURNING id INTO v_orc_id;
    UPDATE public.orcamentos_3d SET orcamento_id = v_orc_id WHERE id = NEW.id;
  ELSE
    UPDATE public.orcamentos
       SET cliente_id = NEW.cliente_id,
           titulo = NEW.titulo,
           status = CASE WHEN public.orcamento_transicao_permitida(status::text, v_status::text) THEN v_status ELSE status END,
           valor_subtotal = coalesce(NEW.preco_comercial,0),
           valor_total = coalesce(NEW.preco_comercial,0),
           contato_nome = NEW.contato_nome,
           contato_telefone = NEW.contato_telefone,
           contato_email = NEW.contato_email,
           os_id = coalesce(NEW.os_id, os_id),
           updated_at = now()
     WHERE id = NEW.orcamento_id;
  END IF;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.sync_orcamento_3d_para_funil() FROM PUBLIC, anon, authenticated;

DO $ensaio$
DECLARE
  estados text[] := ARRAY['rascunho','enviado','aprovado','rejeitado','expirado','convertido'];
  permitidas text[] := ARRAY['rascunho>enviado','enviado>aprovado','enviado>rejeitado','enviado>expirado','expirado>enviado','aprovado>convertido'];
  de text; para text; v uuid; esperado text; obtido text; r text := ''; falhas int := 0; n int := 0;
  antes text; depois text; md_sync text; linhas_igual boolean;
BEGIN
  -- [1] as 36 combinacoes, cada uma numa sub-transacao: permitida passa, proibida da OR001, igual a si mesma passa
  FOREACH de IN ARRAY estados LOOP
    FOREACH para IN ARRAY estados LOOP
      esperado := CASE WHEN de = para OR (de || '>' || para) = ANY (permitidas) THEN 'ok' ELSE 'OR001' END;
      SELECT id INTO v FROM public.orcamentos WHERE status::text = de ORDER BY (valor_total > 0) DESC, numero LIMIT 1;
      IF v IS NULL THEN r := r || format(E'    SEM LINHA em %s, caso %s>%s nao testado\n', de, de, para); falhas := falhas + 1; CONTINUE; END IF;
      BEGIN
        UPDATE public.orcamentos SET status = para::public.status_orcamento WHERE id = v;
        obtido := 'ok';
      EXCEPTION WHEN OTHERS THEN
        obtido := SQLSTATE;
        IF SQLSTATE = 'OR001' AND SQLERRM NOT LIKE 'Este orçamento não pode mudar de ' || de || ' para ' || para || '.' THEN obtido := 'OR001 com texto errado: ' || SQLERRM; END IF;
      END;
      n := n + 1;
      IF obtido <> esperado THEN falhas := falhas + 1; r := r || format(E'    FALHOU %s>%s esperado=%s obtido=%s\n', de, para, esperado, obtido); END IF;
    END LOOP;
  END LOOP;
  r := r || format(E'[1] %s combinacoes testadas, falhas=%s (6 permitidas + 6 iguais passam, 24 proibidas dao OR001)\n', n, falhas);

  -- [2] UPDATE de outra coluna nao dispara a trava; INSERT nao e barrado (o gatilho e so UPDATE OF status)
  SELECT id INTO v FROM public.orcamentos WHERE status::text = 'aprovado' LIMIT 1;
  BEGIN UPDATE public.orcamentos SET observacao_interna = coalesce(observacao_interna, '') WHERE id = v; obtido := 'ok'; EXCEPTION WHEN OTHERS THEN obtido := SQLSTATE; END;
  r := r || format(E'[2] UPDATE de outra coluna em aprovado: %s (esperado ok)\n', obtido);
  IF obtido <> 'ok' THEN falhas := falhas + 1; END IF;

  -- [3] forma do UPDATE da sync_orcamento_3d_para_funil: 3D em rascunho nao puxa enviado de volta
  SELECT id, status::text INTO v, antes FROM public.orcamentos WHERE status::text = 'enviado' ORDER BY numero LIMIT 1;
  BEGIN
    UPDATE public.orcamentos o SET status = CASE WHEN public.orcamento_transicao_permitida(o.status::text, 'rascunho') THEN 'rascunho'::public.status_orcamento ELSE o.status END WHERE o.id = v;
    SELECT status::text INTO depois FROM public.orcamentos WHERE id = v; obtido := depois;
  EXCEPTION WHEN OTHERS THEN obtido := SQLSTATE; END;
  r := r || format(E'[3] forma da sync, 3D rascunho sobre orcamento enviado: ficou %s (esperado enviado)\n', obtido);
  IF obtido <> 'enviado' THEN falhas := falhas + 1; END IF;

  -- [4] estrutura: gatilho, corpo da sync, acessos
  r := r || format(E'[4] gatilho BEFORE UPDATE OF status presente=%s\n', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orcamentos'::regclass AND tgname = 'tg_orcamento_transicao_de_status' AND pg_get_triggerdef(oid) LIKE '%BEFORE UPDATE OF status ON public.orcamentos%'));
  r := r || format(E'    corpo da sync com o CASE=%s md5 novo da sync=%s\n', (SELECT prosrc LIKE '%orcamento_transicao_permitida(status::text, v_status::text)%' FROM pg_proc WHERE oid = 'public.sync_orcamento_3d_para_funil()'::regprocedure), (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.sync_orcamento_3d_para_funil()'::regprocedure));
  r := r || format(E'    anon executa gatilho=%s authenticated executa gatilho=%s anon executa tabela=%s authenticated executa tabela=%s service_role executa gatilho=%s\n',
    has_function_privilege('anon', 'public.tg_orcamento_transicao_de_status()', 'EXECUTE'), has_function_privilege('authenticated', 'public.tg_orcamento_transicao_de_status()', 'EXECUTE'),
    has_function_privilege('anon', 'public.orcamento_transicao_permitida(text,text)', 'EXECUTE'), has_function_privilege('authenticated', 'public.orcamento_transicao_permitida(text,text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.tg_orcamento_transicao_de_status()', 'EXECUTE'));

  IF falhas > 0 THEN RAISE EXCEPTION E'ENSAIO FALHOU, DESFEITO (falhas=%):\n%', falhas, r; END IF;
  RAISE EXCEPTION E'ENSAIO OK, DESFEITO:\n%', r;
END
$ensaio$;

```

Depois do ensaio, conferir no banco vivo que nada ficou: `SELECT count(*) FROM pg_trigger WHERE tgname = 'tg_orcamento_transicao_de_status'` deve dar 0, e `md5(prosrc)` de `sync_orcamento_3d_para_funil` deve continuar `45167125eda9df1a95c9ab0cefa8e28a`.
