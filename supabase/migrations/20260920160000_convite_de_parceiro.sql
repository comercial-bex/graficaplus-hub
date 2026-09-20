-- Fase 1 do clube de revendedores: cada parceiro convida outro.
--
-- A ideia é a do começo das redes sociais: um revendedor manda o link para
-- outro, e quem entra fica ligado a quem convidou. O vínculo é o que permite,
-- na fase 2, pagar o bônus de indicação — 1% das três primeiras compras pagas
-- do indicado, teto de R$ 50 (números em artifact "Convite, Crédito e Rede",
-- 20/09/2026, calculados sobre a margem real de 57,8%).
--
-- Duas decisões de segurança que moldam tudo aqui:
--
-- 1. Quem se cadastra entra como `pendente`, NUNCA como `ativo`. Parceiro ativo
--    enxerga preço de revenda (15% a 30% abaixo do balcão), que é informação
--    comercial sua. Quem libera é a gráfica, na tela de Parceiros.
-- 2. O cadastro NÃO cria papel nenhum. Conta sem papel foi varrida em
--    20/09/2026 e não lê nem escreve nada — nem consegue se promover a admin.
--    O papel `parceiro` só é atribuído na aprovação.
--
-- COMO DESFAZER:
--   drop function public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text);
--   drop function public.convite_de_parceiro(text);
--   alter table public.parceiros drop column codigo_convite, drop column indicado_por, drop column indicado_em;
--   alter table public.parceiros drop constraint parceiros_status_check;
--   alter table public.parceiros add constraint parceiros_status_check
--     check (status = any (array['ativo','suspenso','encerrado']));

-- ---------------------------------------------------------------- 1. colunas
ALTER TABLE public.parceiros
  ADD COLUMN IF NOT EXISTS codigo_convite text,
  ADD COLUMN IF NOT EXISTS indicado_por uuid REFERENCES public.parceiros(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS indicado_em timestamptz;

COMMENT ON COLUMN public.parceiros.codigo_convite IS
  'Código permanente do link de convite deste parceiro. Quem se cadastra por ele fica ligado aqui.';
COMMENT ON COLUMN public.parceiros.indicado_por IS
  'Qual parceiro convidou este. Um nível só — indicado de indicado não sobe a cadeia.';

-- --------------------------------------------------- 2. gerador de código
-- Sem caracteres ambíguos (0/O, 1/I/L): o código vai ser lido em voz alta e
-- digitado à mão por gente no balcão.
CREATE OR REPLACE FUNCTION public.gerar_codigo_convite()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $function$
DECLARE
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
  v_tentativas int := 0;
BEGIN
  LOOP
    v_codigo := '';
    FOR i IN 1..8 LOOP
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.parceiros WHERE codigo_convite = v_codigo);

    v_tentativas := v_tentativas + 1;
    IF v_tentativas > 20 THEN
      RAISE EXCEPTION 'Não consegui gerar um código de convite único';
    END IF;
  END LOOP;

  RETURN v_codigo;
END;
$function$;

-- Todo parceiro nasce com código — inclusive os cadastrados à mão pela gráfica.
CREATE OR REPLACE FUNCTION public.tg_parceiro_codigo_convite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.codigo_convite IS NULL THEN
    NEW.codigo_convite := public.gerar_codigo_convite();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_parceiro_codigo_convite ON public.parceiros;
CREATE TRIGGER aa_parceiro_codigo_convite
  BEFORE INSERT ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_codigo_convite();

UPDATE public.parceiros SET codigo_convite = public.gerar_codigo_convite()
WHERE codigo_convite IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS parceiros_codigo_convite_key
  ON public.parceiros (codigo_convite);

-- ------------------------------------------------------- 3. status pendente
ALTER TABLE public.parceiros DROP CONSTRAINT IF EXISTS parceiros_status_check;
ALTER TABLE public.parceiros ADD CONSTRAINT parceiros_status_check
  CHECK (status = ANY (ARRAY['pendente'::text, 'ativo'::text, 'suspenso'::text, 'encerrado'::text]));

-- --------------------------------------------- 4. o que a página de convite vê
-- Chamada por quem ainda não tem conta, então devolve o MÍNIMO: só o nome de
-- quem convidou, para a página dizer "Convidado por Gráfica X". Nenhum id,
-- nenhum dado de contato, nada que sirva para enumerar parceiros.
CREATE OR REPLACE FUNCTION public.convite_de_parceiro(p_codigo text)
RETURNS TABLE(valido boolean, convidado_por text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT true,
         coalesce(nullif(btrim(p.marca_nome), ''), c.nome, 'um parceiro Bex Print')
  FROM public.parceiros p
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
  WHERE upper(btrim(p_codigo)) = p.codigo_convite
    AND p.status = 'ativo'
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.convite_de_parceiro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convite_de_parceiro(text) TO anon, authenticated;

-- ------------------------------------------------- 5. o cadastro pelo convite
-- Chamada logo depois do signUp, com o id do usuário recém-criado. Não exige
-- sessão: quem acabou de se cadastrar ainda não entrou, e forçar login antes
-- da aprovação daria a ele uma conta sem papel olhando tela vazia.
--
-- Os guardas que substituem a sessão:
--   - o código precisa existir e ser de parceiro ATIVO;
--   - o usuário precisa existir e ter sido criado nos últimos 15 minutos
--     (impede apontar o cadastro para a conta de outra pessoa);
--   - o usuário não pode já ser parceiro.
CREATE OR REPLACE FUNCTION public.parceiro_cadastrar_por_convite(
  p_codigo text,
  p_usuario_id uuid,
  p_marca_nome text,
  p_documento text DEFAULT NULL,
  p_telefone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_estado text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_padrinho public.parceiros%ROWTYPE;
  v_criado_em timestamptz;
  v_cliente_id uuid;
  v_parceiro_id uuid;
  v_nome text := nullif(btrim(p_marca_nome), '');
BEGIN
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da sua empresa' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_padrinho FROM public.parceiros
  WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023';
  END IF;

  SELECT created_at INTO v_criado_em FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023';
  END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN
    RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.clientes (nome, documento, telefone, email, cidade, estado, origem, ativo)
  VALUES (v_nome, nullif(btrim(p_documento), ''), nullif(btrim(p_telefone), ''),
          nullif(btrim(p_email), ''), nullif(btrim(p_cidade), ''), nullif(btrim(p_estado), ''),
          'convite_parceiro', true)
  RETURNING id INTO v_cliente_id;

  -- Nasce pendente e sem papel: quem libera é a gráfica.
  INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_documento,
                                marca_telefone, marca_email, marca_cidade, marca_estado,
                                indicado_por, indicado_em)
  VALUES (v_cliente_id, p_usuario_id, 'pendente', v_nome, nullif(btrim(p_documento), ''),
          nullif(btrim(p_telefone), ''), nullif(btrim(p_email), ''), nullif(btrim(p_cidade), ''),
          nullif(btrim(p_estado), ''), v_padrinho.id, now())
  RETURNING id INTO v_parceiro_id;

  RETURN jsonb_build_object(
    'ok', true,
    'parceiro_id', v_parceiro_id,
    'convidado_por', coalesce(v_padrinho.marca_nome, 'Bex Print')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text) TO anon, authenticated;

-- ------------------------------------------------- 6. fila de liberação
-- Sem esta fila o cadastro seria um buraco: a pessoa se cadastra, fica
-- `pendente`, e a gráfica não fica sabendo que alguém está esperando.
CREATE OR REPLACE FUNCTION public.parceiros_pendentes()
RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text,
              cidade text, estado text, convidado_por text, criado_em timestamptz, tem_login boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN QUERY
  SELECT p.id,
         coalesce(nullif(btrim(p.marca_nome),''), c.nome),
         p.marca_documento, p.marca_telefone, p.marca_email,
         p.marca_cidade, p.marca_estado,
         coalesce(nullif(btrim(padrinho.marca_nome),''), pc.nome, 'cadastro direto'),
         p.created_at,
         p.usuario_id IS NOT NULL
  FROM public.parceiros p
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
  LEFT JOIN public.parceiros padrinho ON padrinho.id = p.indicado_por
  LEFT JOIN public.clientes pc ON pc.id = padrinho.cliente_id
  WHERE p.status = 'pendente'
  ORDER BY p.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.parceiro_aprovar(p_parceiro_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p public.parceiros%ROWTYPE;
BEGIN
  PERFORM public.require_permission('parceiros.manage');

  SELECT * INTO v_p FROM public.parceiros WHERE id = p_parceiro_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parceiro não encontrado.'; END IF;
  IF v_p.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este parceiro não está aguardando liberação (está %).', v_p.status;
  END IF;

  UPDATE public.parceiros SET status = 'ativo', updated_at = now() WHERE id = p_parceiro_id;

  -- O papel é o que abre o painel. Sem ele a pessoa entra e não vê nada —
  -- que é exatamente o estado seguro em que ela ficou desde o cadastro.
  IF v_p.usuario_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_p.usuario_id, 'parceiro')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'parceiro_id', p_parceiro_id,
                            'liberou_acesso', v_p.usuario_id IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.parceiros_pendentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiros_pendentes() TO authenticated;
REVOKE ALL ON FUNCTION public.parceiro_aprovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_aprovar(uuid) TO authenticated;

-- ------------------------------------------- 7. o painel do parceiro
-- `parceiro_painel()` ganhou codigo_convite, indicados, indicados_ativos e
-- ganho_indicacao dentro do objeto 'parceiro'. Emenda aplicada por
-- pg_get_functiondef + replace, para não reescrever a função inteira.
-- O painel mostra NÚMERO e TOTAL GANHO; nome e compra de indicado não entram:
-- é dado de cliente de terceiro.
