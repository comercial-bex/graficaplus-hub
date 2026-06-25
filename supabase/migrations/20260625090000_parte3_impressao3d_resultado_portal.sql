-- Parte 3: impressão 3D, resultado financeiro, dashboards, portal e pós-venda.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Permissões 3D
INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
('impressao3d.read','impressao3d','Ler módulo de impressão 3D'),
('impressao3d.quote.create','impressao3d','Criar orçamento 3D'),
('impressao3d.quote.update','impressao3d','Atualizar orçamento 3D'),
('impressao3d.quote.approve','impressao3d','Aprovar orçamento 3D'),
('impressao3d.cost.read','impressao3d','Visualizar custos 3D'),
('impressao3d.cost.manage','impressao3d','Gerenciar regras de custo 3D'),
('impressao3d.production.update','impressao3d','Apontar produção 3D'),
('impressao3d.close','impressao3d','Fechar produção 3D'),
('impressao3d.settings.manage','impressao3d','Gerenciar configurações 3D'),
('impressao3d.reports.read','impressao3d','Ler relatórios 3D')
ON CONFLICT (chave) DO UPDATE SET dominio=EXCLUDED.dominio, descricao=EXCLUDED.descricao;

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT p.perfil, pe.chave FROM (VALUES ('administrador'),('admin')) p(perfil) CROSS JOIN public.permissoes pe ON CONFLICT DO NOTHING;
INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT * FROM (VALUES
('vendedor','impressao3d.read'),('vendedor','impressao3d.quote.create'),('vendedor','impressao3d.quote.update'),
('gerente','impressao3d.read'),('gerente','impressao3d.quote.create'),('gerente','impressao3d.quote.update'),('gerente','impressao3d.quote.approve'),('gerente','impressao3d.cost.read'),('gerente','impressao3d.reports.read'),
('operador','impressao3d.read'),('operador','impressao3d.production.update'),
('financeiro','impressao3d.read'),('financeiro','impressao3d.cost.read'),('financeiro','impressao3d.reports.read')
) v(perfil, permissao) ON CONFLICT DO NOTHING;

-- Máquina 3D = extensão 1:1 de máquinas
CREATE TABLE IF NOT EXISTS public.maquinas_3d_config (
  maquina_id UUID PRIMARY KEY REFERENCES public.maquinas(id) ON DELETE CASCADE,
  fabricante TEXT, modelo TEXT, serial TEXT, tecnologia TEXT NOT NULL DEFAULT 'FFF/FDM',
  custo_aquisicao NUMERIC(14,4) NOT NULL DEFAULT 0, frete_aquisicao NUMERIC(14,4) NOT NULL DEFAULT 0,
  instalacao NUMERIC(14,4) NOT NULL DEFAULT 0, acessorios_capitalizados NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_residual NUMERIC(14,4) NOT NULL DEFAULT 0, vida_util_horas NUMERIC(14,4) NOT NULL DEFAULT 1,
  horas_acumuladas NUMERIC(14,4) NOT NULL DEFAULT 0, manutencao_por_hora NUMERIC(14,4) NOT NULL DEFAULT 0,
  consumiveis_por_hora NUMERIC(14,4) NOT NULL DEFAULT 0, infraestrutura_por_hora NUMERIC(14,4) NOT NULL DEFAULT 0,
  potencia_media_w NUMERIC(14,4) NOT NULL DEFAULT 0, potencia_aquecimento_w NUMERIC(14,4) NOT NULL DEFAULT 0,
  potencia_standby_w NUMERIC(14,4) NOT NULL DEFAULT 0, horas_produtivas_mensais NUMERIC(14,4) NOT NULL DEFAULT 1,
  metodo_custo_hora TEXT NOT NULL DEFAULT 'depreciacao_hora' CHECK (metodo_custo_hora IN ('depreciacao_hora','fixo_mensal','manual')),
  custo_hora_calculado NUMERIC(14,4) NOT NULL DEFAULT 0, custo_hora_manual NUMERIC(14,4), motivo_custo_manual TEXT,
  custo_hora_manual_usuario_id UUID REFERENCES public.usuarios(id), custo_hora_manual_at TIMESTAMPTZ,
  capacidade_x NUMERIC(14,4), capacidade_y NUMERIC(14,4), capacidade_z NUMERIC(14,4),
  possui_ams BOOLEAN NOT NULL DEFAULT false, quantidade_slots INT NOT NULL DEFAULT 0, bico_padrao TEXT, placa_padrao TEXT,
  consumiveis_json JSONB NOT NULL DEFAULT '{}'::jsonb, ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vida_util_horas > 0), CHECK (horas_produtivas_mensais > 0),
  CHECK (metodo_custo_hora <> 'manual' OR (custo_hora_manual IS NOT NULL AND length(coalesce(motivo_custo_manual,'')) >= 10))
);
CREATE OR REPLACE FUNCTION public.audit_maquina_3d_manual() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.metodo_custo_hora='manual' AND (TG_OP='INSERT' OR NEW.custo_hora_manual IS DISTINCT FROM OLD.custo_hora_manual OR NEW.motivo_custo_manual IS DISTINCT FROM OLD.motivo_custo_manual) THEN
    PERFORM public.require_permission('impressao3d.cost.manage');
    NEW.custo_hora_manual_usuario_id := auth.uid(); NEW.custo_hora_manual_at := now();
    INSERT INTO public.eventos_negocio(entidade, entidade_id, tipo, titulo, descricao, dados_posteriores, usuario_id)
    VALUES ('maquinas_3d_config', NEW.maquina_id, 'custo_hora_manual', 'Custo-hora manual 3D', NEW.motivo_custo_manual, to_jsonb(NEW), auth.uid());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_maquina_3d_manual ON public.maquinas_3d_config;
CREATE TRIGGER trg_audit_maquina_3d_manual BEFORE INSERT OR UPDATE ON public.maquinas_3d_config FOR EACH ROW EXECUTE FUNCTION public.audit_maquina_3d_manual();

-- Filamento = extensão de materiais; rolo = material_lotes enriquecido.
CREATE TABLE IF NOT EXISTS public.materiais_3d_filamento (
  material_id UUID PRIMARY KEY REFERENCES public.materiais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, marca TEXT, linha TEXT, cor TEXT, codigo TEXT, diametro NUMERIC(10,4) NOT NULL DEFAULT 1.75,
  densidade NUMERIC(10,4), peso_nominal NUMERIC(14,4), peso_liquido NUMERIC(14,4) NOT NULL DEFAULT 0,
  tara_carretel NUMERIC(14,4) NOT NULL DEFAULT 0, custo_compra NUMERIC(14,4) NOT NULL DEFAULT 0,
  frete_rateado NUMERIC(14,4) NOT NULL DEFAULT 0, tributos_aquisicao NUMERIC(14,4) NOT NULL DEFAULT 0,
  descontos NUMERIC(14,4) NOT NULL DEFAULT 0, outros_custos NUMERIC(14,4) NOT NULL DEFAULT 0,
  fator_aproveitamento NUMERIC(8,6) NOT NULL DEFAULT 1 CHECK (fator_aproveitamento > 0 AND fator_aproveitamento <= 1),
  exige_secagem BOOLEAN NOT NULL DEFAULT false, tempo_secagem NUMERIC(10,4), potencia_secador NUMERIC(10,4), temperatura_secagem NUMERIC(10,4), armazenamento TEXT,
  custo_por_grama_calculado NUMERIC(14,6) GENERATED ALWAYS AS (CASE WHEN peso_liquido * fator_aproveitamento > 0 THEN round(((custo_compra+frete_rateado+tributos_aquisicao+outros_custos-descontos)/(peso_liquido*fator_aproveitamento))::numeric,6) ELSE 0 END) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS peso_inicial NUMERIC(14,4);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS tara NUMERIC(14,4);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS saldo_estimado NUMERIC(14,4);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS saldo_medido NUMERIC(14,4);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS custo_total NUMERIC(14,4);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS custo_por_grama_snapshot NUMERIC(14,6);
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS localizacao TEXT;
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS slot_ams INT;
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disponivel';
ALTER TABLE public.material_lotes ADD COLUMN IF NOT EXISTS observacao TEXT;

-- Orçamento 3D integrado
CREATE TABLE IF NOT EXISTS public.orcamentos_3d (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id), lead_id UUID REFERENCES public.leads(id), titulo TEXT NOT NULL, descricao TEXT,
  quantidade NUMERIC(14,4) NOT NULL DEFAULT 1, prazo TIMESTAMPTZ,
  nivel_precisao TEXT NOT NULL DEFAULT 'estimativa_preliminar' CHECK (nivel_precisao IN ('estimativa_preliminar','validado_pelo_fatiador','reconciliado','realizado')),
  status TEXT NOT NULL DEFAULT 'rascunho', versao_motor TEXT NOT NULL, validade DATE, moeda TEXT NOT NULL DEFAULT 'BRL',
  preco_nao_arredondado NUMERIC(14,6), preco_comercial NUMERIC(14,2), created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.slicer_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_3d_id UUID REFERENCES public.orcamentos_3d(id) ON DELETE CASCADE,
  arquivo_id UUID REFERENCES public.arquivos(id), nome_arquivo TEXT NOT NULL, extensao TEXT NOT NULL, mime TEXT, tamanho BIGINT NOT NULL,
  sha256 TEXT NOT NULL, parser TEXT NOT NULL, raw_json JSONB NOT NULL DEFAULT '{}'::jsonb, normalized_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  campos_encontrados TEXT[] NOT NULL DEFAULT '{}', campos_ausentes TEXT[] NOT NULL DEFAULT '{}', correcoes_manuais JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrigido_por UUID REFERENCES public.usuarios(id), created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.orcamento_3d_placas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_3d_id UUID NOT NULL REFERENCES public.orcamentos_3d(id) ON DELETE CASCADE, maquina_id UUID REFERENCES public.maquinas(id), nome_placa TEXT,
  quantidade_pecas INT NOT NULL DEFAULT 1, repeticoes INT NOT NULL DEFAULT 1, tempo_estimado_segundos INT NOT NULL DEFAULT 0, tempo_real_segundos INT,
  setup_minutos NUMERIC(10,2) NOT NULL DEFAULT 0, resfriamento_minutos NUMERIC(10,2) NOT NULL DEFAULT 0, retirada_minutos NUMERIC(10,2) NOT NULL DEFAULT 0,
  perfil TEXT, bico TEXT, altura_camada NUMERIC(10,4), infill NUMERIC(8,4), paredes INT, suporte BOOLEAN NOT NULL DEFAULT false, usa_ams BOOLEAN NOT NULL DEFAULT false, quantidade_trocas INT NOT NULL DEFAULT 0,
  arquivo_id UUID REFERENCES public.arquivos(id), arquivo_hash TEXT, fonte TEXT NOT NULL DEFAULT 'manual', dados_brutos_json JSONB NOT NULL DEFAULT '{}'::jsonb, sliced_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.orcamento_3d_consumos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), placa_id UUID NOT NULL REFERENCES public.orcamento_3d_placas(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.materiais(id), lote_id UUID REFERENCES public.material_lotes(id), extrusor TEXT, slot_ams INT,
  gramas_modelo NUMERIC(14,4) NOT NULL DEFAULT 0, gramas_suporte NUMERIC(14,4) NOT NULL DEFAULT 0, gramas_purga NUMERIC(14,4) NOT NULL DEFAULT 0,
  gramas_torre NUMERIC(14,4) NOT NULL DEFAULT 0, gramas_preparacao NUMERIC(14,4) NOT NULL DEFAULT 0, gramas_extras NUMERIC(14,4) NOT NULL DEFAULT 0,
  gramas_totais NUMERIC(14,4) GENERATED ALWAYS AS (gramas_modelo+gramas_suporte+gramas_purga+gramas_torre+gramas_preparacao+gramas_extras) STORED,
  custo_por_grama_snapshot NUMERIC(14,6) NOT NULL DEFAULT 0, custo_total NUMERIC(14,4) GENERATED ALWAYS AS (round(((gramas_modelo+gramas_suporte+gramas_purga+gramas_torre+gramas_preparacao+gramas_extras)*custo_por_grama_snapshot)::numeric,4)) STORED,
  fonte TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS public.orcamento_3d_servicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_3d_id UUID NOT NULL REFERENCES public.orcamentos_3d(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('atendimento técnico','modelagem','reparo de arquivo','fatiamento','preparação','troca de filamento','retirada','remoção de suporte','lixamento','primer','pintura','colagem','montagem','insertos','acabamento','embalagem','entrega','instalação','terceiros','outro')),
  descricao TEXT, quantidade NUMERIC(14,4) NOT NULL DEFAULT 1, minutos NUMERIC(14,4) NOT NULL DEFAULT 0, custo_hora NUMERIC(14,4) NOT NULL DEFAULT 0,
  custo NUMERIC(14,4) NOT NULL DEFAULT 0, preco_separado NUMERIC(14,4), responsavel UUID REFERENCES public.usuarios(id)
);
CREATE TABLE IF NOT EXISTS public.orcamento_3d_calculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_3d_id UUID NOT NULL REFERENCES public.orcamentos_3d(id) ON DELETE CASCADE, versao INT NOT NULL,
  nivel_precisao TEXT NOT NULL CHECK (nivel_precisao IN ('estimativa_preliminar','validado_pelo_fatiador','reconciliado','realizado')),
  inputs_json JSONB NOT NULL, resultados_json JSONB NOT NULL, snapshots_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  custo_material NUMERIC(14,4) NOT NULL DEFAULT 0, custo_maquina NUMERIC(14,4) NOT NULL DEFAULT 0, custo_energia NUMERIC(14,4) NOT NULL DEFAULT 0,
  custo_mao_obra NUMERIC(14,4) NOT NULL DEFAULT 0, custo_acabamento NUMERIC(14,4) NOT NULL DEFAULT 0, custo_embalagem NUMERIC(14,4) NOT NULL DEFAULT 0,
  custo_terceiros NUMERIC(14,4) NOT NULL DEFAULT 0, custo_risco NUMERIC(14,4) NOT NULL DEFAULT 0, custo_indireto NUMERIC(14,4) NOT NULL DEFAULT 0,
  custo_operacional NUMERIC(14,4) NOT NULL DEFAULT 0, preco_minimo NUMERIC(14,4) NOT NULL DEFAULT 0, preco_sugerido NUMERIC(14,4) NOT NULL DEFAULT 0,
  preco_praticado NUMERIC(14,4) NOT NULL DEFAULT 0, lucro NUMERIC(14,4) NOT NULL DEFAULT 0, margem NUMERIC(10,6) NOT NULL DEFAULT 0,
  markup NUMERIC(10,6) NOT NULL DEFAULT 0, valor_unitario NUMERIC(14,4) NOT NULL DEFAULT 0, versao_motor TEXT NOT NULL, created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(orcamento_3d_id, versao)
);
CREATE OR REPLACE FUNCTION public.prevent_update_orcamento_3d_calculos() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'orcamento_3d_calculos é imutável; gere nova versão'; END $$;
DROP TRIGGER IF EXISTS trg_immutable_orcamento_3d_calculos ON public.orcamento_3d_calculos;
CREATE TRIGGER trg_immutable_orcamento_3d_calculos BEFORE UPDATE OR DELETE ON public.orcamento_3d_calculos FOR EACH ROW EXECUTE FUNCTION public.prevent_update_orcamento_3d_calculos();

-- Produção, fechamento 3D, portal e pós-venda
CREATE TABLE IF NOT EXISTS public.producao_3d_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), orcamento_3d_id UUID REFERENCES public.orcamentos_3d(id), placa_id UUID REFERENCES public.orcamento_3d_placas(id), maquina_id UUID REFERENCES public.maquinas(id), agenda_id UUID REFERENCES public.maquinas_agenda(id), status TEXT NOT NULL DEFAULT 'planejado', repeticao INT NOT NULL DEFAULT 1, custo_previsto_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, custo_real_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.producao_3d_apontamentos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID NOT NULL REFERENCES public.producao_3d_jobs(id) ON DELETE CASCADE, apontamento_id UUID REFERENCES public.apontamentos_producao(id), operador_id UUID REFERENCES public.usuarios(id), inicio TIMESTAMPTZ NOT NULL DEFAULT now(), fim TIMESTAMPTZ, pausas JSONB NOT NULL DEFAULT '[]'::jsonb, tempo_real_segundos INT, resultado TEXT NOT NULL DEFAULT 'em_andamento', percentual_consumido_antes_falha NUMERIC(8,4), consumo_real_json JSONB NOT NULL DEFAULT '[]'::jsonb, energia_real_kwh NUMERIC(14,4), observacao TEXT, ocorrencia_id UUID REFERENCES public.ocorrencias(id), arquivo_log_id UUID REFERENCES public.arquivos(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.producao_3d_fechamentos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, os_item_id UUID REFERENCES public.itens_os(id), tempo_previsto_segundos INT NOT NULL DEFAULT 0, tempo_real_segundos INT NOT NULL DEFAULT 0, material_previsto_g NUMERIC(14,4) NOT NULL DEFAULT 0, material_real_g NUMERIC(14,4) NOT NULL DEFAULT 0, purga_prevista_g NUMERIC(14,4) NOT NULL DEFAULT 0, purga_real_g NUMERIC(14,4) NOT NULL DEFAULT 0, custo_previsto NUMERIC(14,4) NOT NULL DEFAULT 0, custo_real NUMERIC(14,4) NOT NULL DEFAULT 0, falhas INT NOT NULL DEFAULT 0, reimpressoes INT NOT NULL DEFAULT 0, lucro_previsto NUMERIC(14,4) NOT NULL DEFAULT 0, lucro_real NUMERIC(14,4) NOT NULL DEFAULT 0, margem_prevista NUMERIC(10,6), margem_real NUMERIC(10,6), causa_diferenca TEXT, closed_by UUID REFERENCES public.usuarios(id), closed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.os_resultado_snapshots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE, resultado_json JSONB NOT NULL, created_by UUID REFERENCES public.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.portal_cliente_acessos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID REFERENCES public.usuarios(id), cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE, ativo BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(usuario_id, cliente_id));
CREATE TABLE IF NOT EXISTS public.portal_cliente_solicitacoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id UUID NOT NULL REFERENCES public.clientes(id), os_id UUID REFERENCES public.ordens_servico(id), orcamento_id UUID REFERENCES public.orcamentos(id), tipo TEXT NOT NULL, mensagem TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberta', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_pesquisas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID REFERENCES public.ordens_servico(id) ON DELETE CASCADE, cliente_id UUID REFERENCES public.clientes(id), tipo TEXT NOT NULL DEFAULT 'satisfacao', status TEXT NOT NULL DEFAULT 'agendada', agendada_para TIMESTAMPTZ NOT NULL DEFAULT (now()+ interval '2 days'), enviada_em TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_respostas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pesquisa_id UUID REFERENCES public.pos_venda_pesquisas(id) ON DELETE CASCADE, cliente_id UUID REFERENCES public.clientes(id), nota INT CHECK (nota BETWEEN 0 AND 10), comentario TEXT, nps_classificacao TEXT GENERATED ALWAYS AS (CASE WHEN nota IS NULL THEN NULL WHEN nota >= 9 THEN 'promotor' WHEN nota >= 7 THEN 'neutro' ELSE 'detrator' END) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), os_id UUID REFERENCES public.ordens_servico(id), cliente_id UUID REFERENCES public.clientes(id), tipo TEXT NOT NULL DEFAULT 'suporte', prioridade TEXT NOT NULL DEFAULT 'normal', descricao TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'aberto', prazo_resolucao TIMESTAMPTZ, resolvido_em TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_garantias (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id UUID REFERENCES public.pos_venda_tickets(id), os_id UUID REFERENCES public.ordens_servico(id), cliente_id UUID REFERENCES public.clientes(id), status TEXT NOT NULL DEFAULT 'analise', custo_previsto NUMERIC(14,4) NOT NULL DEFAULT 0, custo_real NUMERIC(14,4) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_retornos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id UUID REFERENCES public.clientes(id), os_id UUID REFERENCES public.ordens_servico(id), motivo TEXT, status TEXT NOT NULL DEFAULT 'aberto', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pos_venda_oportunidades (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id UUID REFERENCES public.clientes(id), os_origem_id UUID REFERENCES public.ordens_servico(id), descricao TEXT, valor_estimado NUMERIC(14,2), status TEXT NOT NULL DEFAULT 'nova', created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Compatibilidade financeira
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS desconto NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_financeiro TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS data_fechamento TIMESTAMPTZ;

-- Resultado e dashboards sem mock
CREATE OR REPLACE VIEW public.vw_resultado_os AS
SELECT os.id os_id, COALESCE(os.valor_total,0) receita_bruta, COALESCE(os.desconto,0) descontos,
       COALESCE(os.valor_total,0)-COALESCE(os.desconto,0) receita_liquida,
       COALESCE(os.custo_previsto,0) custo_previsto,
       COALESCE((SELECT SUM(r.quantidade*l.custo_unitario_snapshot) FROM public.estoque_reservas r LEFT JOIN public.material_lotes l ON l.id=r.lote_id WHERE r.os_id=os.id),0) custo_reservado,
       COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co WHERE co.os_id=os.id),0) custo_realizado,
       (COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))-COALESCE(os.custo_previsto,0) lucro_previsto,
       (COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))-COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co WHERE co.os_id=os.id),0) lucro_realizado,
       CASE WHEN COALESCE(os.valor_total,0)-COALESCE(os.desconto,0)>0 THEN (((COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))-COALESCE(os.custo_previsto,0))/(COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))) END margem_prevista,
       CASE WHEN COALESCE(os.valor_total,0)-COALESCE(os.desconto,0)>0 THEN (((COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))-COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co WHERE co.os_id=os.id),0))/(COALESCE(os.valor_total,0)-COALESCE(os.desconto,0))) END margem_realizada,
       COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co WHERE co.os_id=os.id),0)-COALESCE(os.custo_previsto,0) divergencia_custo,
       COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co WHERE co.os_id=os.id AND co.categoria='retrabalho'),0) retrabalho,
       CASE WHEN os.prazo_entrega IS NOT NULL AND os.prazo_entrega < now() AND os.status NOT IN ('entregue','finalizada','cancelada') THEN true ELSE false END atraso,
       COALESCE(os.status_financeiro,'pendente') status_financeiro
FROM public.ordens_servico os;
CREATE OR REPLACE VIEW public.vw_dashboard_impressao_3d AS SELECT count(j.id) jobs, COALESCE(sum(a.tempo_real_segundos)/3600.0,0) horas_impressas, COALESCE(sum((a.consumo_real_json->0->>'gramas')::numeric),0) gramas_consumidas, count(*) FILTER (WHERE a.resultado='falha') falhas, COALESCE(sum(f.custo_previsto),0) custo_previsto, COALESCE(sum(f.custo_real),0) custo_real, COALESCE(avg(f.margem_real),0) margem_real FROM public.producao_3d_jobs j LEFT JOIN public.producao_3d_apontamentos a ON a.job_id=j.id LEFT JOIN public.producao_3d_fechamentos f ON f.os_id=j.os_id;
CREATE OR REPLACE VIEW public.vw_dashboard_comercial AS SELECT count(*) FILTER (WHERE created_at >= date_trunc('month',now())) orcamentos_mes, COALESCE(avg(valor_total),0) ticket_medio, COALESCE((SELECT avg(oi.margem_prevista) FROM public.orcamento_itens oi),0) margem_prevista FROM public.orcamentos;
CREATE OR REPLACE VIEW public.vw_dashboard_atendimento AS SELECT count(*) conversas, count(*) FILTER (WHERE status='aberta') abertas FROM public.whatsapp_conversas;
CREATE OR REPLACE VIEW public.vw_dashboard_operacao AS SELECT status, count(*) os FROM public.ordens_servico GROUP BY status;
CREATE OR REPLACE VIEW public.vw_dashboard_financeiro AS SELECT COALESCE(sum(receita_liquida),0) faturamento, COALESCE(sum(custo_realizado),0) custo, COALESCE(sum(lucro_realizado),0) lucro, COALESCE(avg(margem_realizada),0) margem FROM public.vw_resultado_os;
CREATE OR REPLACE VIEW public.vw_dashboard_estoque AS SELECT count(*) FILTER (WHERE critico) abaixo_minimo, COALESCE(sum(saldo_reservado),0) reservas FROM public.vw_estoque_critico;
CREATE OR REPLACE VIEW public.vw_dashboard_maquinas AS SELECT count(*) maquinas, COALESCE(sum(a.minutos_reais),0)/60.0 horas_produtivas FROM public.maquinas m LEFT JOIN public.maquinas_agenda a ON a.maquina_id=m.id;
CREATE OR REPLACE VIEW public.vw_dashboard_prazos AS SELECT count(*) FILTER (WHERE atraso) atrasadas FROM public.vw_resultado_os;
CREATE OR REPLACE VIEW public.vw_dashboard_qualidade AS SELECT resultado, count(*) inspecoes FROM public.qualidade_inspecoes GROUP BY resultado;
CREATE OR REPLACE VIEW public.vw_dashboard_retrabalho AS SELECT count(*) retrabalhos, COALESCE(sum(custo_total),0) custo FROM public.retrabalhos;
CREATE OR REPLACE VIEW public.vw_dashboard_logistica AS SELECT status, count(*) entregas FROM public.entregas_instalacoes GROUP BY status;

CREATE OR REPLACE FUNCTION public.fechar_os(p_os_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_result jsonb; v_cliente uuid;
BEGIN
  v_uid := public.require_permission('os.close');
  SELECT cliente_id INTO v_cliente FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM public.os_tarefas WHERE os_id=p_os_id AND obrigatoria AND status NOT IN ('concluida','cancelada')) THEN RAISE EXCEPTION 'Há tarefas obrigatórias pendentes'; END IF;
  IF EXISTS (SELECT 1 FROM public.qualidade_inspecoes WHERE os_id=p_os_id AND resultado IN ('reprovado','retrabalho')) THEN RAISE EXCEPTION 'Há qualidade/retrabalho pendente'; END IF;
  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id=p_os_id;
  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by) VALUES (p_os_id, v_result, v_uid);
  UPDATE public.ordens_servico SET status='finalizada', data_fechamento=now() WHERE id=p_os_id;
  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (p_os_id, v_cliente);
  PERFORM public.registrar_evento_os(p_os_id,'os',p_os_id,'fechamento','OS fechada',NULL,v_result);
  RETURN v_result;
END $$;

-- RLS portal cliente: isolamento no banco, não só frontend.
ALTER TABLE public.portal_cliente_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_cliente_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_venda_respostas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_acesso_cliente ON public.portal_cliente_acessos;
CREATE POLICY portal_acesso_cliente ON public.portal_cliente_acessos FOR SELECT USING (usuario_id = auth.uid());
DROP POLICY IF EXISTS portal_solicitacao_cliente ON public.portal_cliente_solicitacoes;
CREATE POLICY portal_solicitacao_cliente ON public.portal_cliente_solicitacoes FOR ALL USING (EXISTS (SELECT 1 FROM public.portal_cliente_acessos a WHERE a.usuario_id=auth.uid() AND a.cliente_id=portal_cliente_solicitacoes.cliente_id AND a.ativo)) WITH CHECK (EXISTS (SELECT 1 FROM public.portal_cliente_acessos a WHERE a.usuario_id=auth.uid() AND a.cliente_id=portal_cliente_solicitacoes.cliente_id AND a.ativo));
DROP POLICY IF EXISTS pos_venda_resposta_cliente ON public.pos_venda_respostas;
CREATE POLICY pos_venda_resposta_cliente ON public.pos_venda_respostas FOR ALL USING (EXISTS (SELECT 1 FROM public.portal_cliente_acessos a WHERE a.usuario_id=auth.uid() AND a.cliente_id=pos_venda_respostas.cliente_id AND a.ativo)) WITH CHECK (EXISTS (SELECT 1 FROM public.portal_cliente_acessos a WHERE a.usuario_id=auth.uid() AND a.cliente_id=pos_venda_respostas.cliente_id AND a.ativo));

-- Storage privado de slicer
INSERT INTO storage.buckets (id, name, public) VALUES ('slicer-imports','slicer-imports',false) ON CONFLICT (id) DO UPDATE SET public=false;
