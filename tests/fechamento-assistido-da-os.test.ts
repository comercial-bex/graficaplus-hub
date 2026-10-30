import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROTULO_BLOQUEIO, rotuloBloqueio } from "../src/domain/os/etapas";

/**
 * Fechamento assistido da OS (decisão por delegação do dono, 30/10/2026; diagnóstico final, 8.1 da operação).
 *
 * `fechar_os` exigia seis registros que a equipe ainda não faz e NENHUMA das 18 OS abertas cumpria todos: o painel
 * mostrava 1 de 19 OS concluída. A trava passou a separar FATO (continua travando) de REGISTRO (o sistema cobre
 * com o dado real, ou com o previsto, e marca a OS como "fechada com estimativa").
 *
 * Ensaiado no banco em transação desfeita, nas 19 OS abertas de venda: as pagas e que saíram fecham (a 212, ao
 * registrar a retirada: custo 4,00, margem 89,33%, estimado); as que devem dinheiro seguem travadas
 * (`pagamentos_pendentes`); a 168, sem custo previsto, não fecha (`sem_custo_previsto`); o vendedor, sem a permissão
 * de exceção, é barrado em OS que ainda está na produção (`peca_nao_saiu`) e consegue fechar a que o cliente retirou.
 */
const SQL = readFileSync(
  join(__dirname, "..", "supabase/migrations/20261030850000_fechamento_assistido_da_os.sql"),
  "utf8",
);

describe("o que continua travando o fechamento (fatos)", () => {
  it.each([
    "tarefas_obrigatorias",
    "qualidade_reprovada_ou_retrabalho",
    "ocorrencias_tratadas",
    "logistica_concluida",
    "apontamento_aberto",
    "peca_nao_saiu",
    "pagamentos_pendentes",
  ])("%s trava", (codigo) => {
    expect(SQL).toContain(`v_bloqueios := v_bloqueios || '"${codigo}"'::jsonb`);
  });

  it("a peça que não saiu só passa para quem tem a permissão de exceção (os.status.override)", () => {
    expect(SQL).toContain("AND NOT public.os_saiu_fisicamente(fechar_os.os_id)");
    expect(SQL).toContain(
      "NOT IN ('aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao')",
    );
    expect(SQL).toContain("AND NOT public.has_permission(v_uid, 'os.status.override')");
  });

  it("sem custo lançado e sem custo previsto não há o que estimar: não fecha", () => {
    expect(SQL).toContain(`'["sem_custo_previsto"]'::jsonb`);
  });
});

describe("o que o fechamento assistido cobre (registros)", () => {
  it.each([
    "qualidade_aprovada",
    "materiais_baixados",
    "custos_operacionais",
    "sem_layout",
    "sem_medidas",
  ])("%s deixa de travar e vira estimativa", (codigo) => {
    expect(SQL).toContain(`v_suaves := array_append(v_suaves, '${codigo}')`);
    expect(SQL).not.toContain(`v_bloqueios := v_bloqueios || '"${codigo}"'::jsonb`);
  });

  it("material: baixa pela reserva quando dá; senão o custo do material pelo previsto", () => {
    expect(SQL).toContain("PERFORM public.baixar_estoque_os(fechar_os.os_id);");
    expect(SQL).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(SQL).toContain("'material', 'fechamento_assistido', 1, v_valor_mat");
  });

  it("máquina e mão de obra: o previsto entra só se ninguém apontou nada que não seja material", () => {
    expect(SQL).toContain("co.categoria <> 'material' AND co.total > 0");
    expect(SQL).toContain("'maquina', 'fechamento_assistido', 1, v_nao_mat");
    expect(SQL).toContain("COALESCE(v_prev_total, 0) - COALESCE(v_prev_mat, 0)");
  });

  it("medida só é exigida de produto vendido em m² (chaveiro e brinde não têm largura nem altura)", () => {
    expect(SQL).toContain("lower(replace(COALESCE(pr.unidade, ''), '²', '2')) = 'm2'");
  });

  it("o que foi estimado fica gravado na OS e no snapshot do resultado", () => {
    expect(SQL).toContain("fechamento_estimado = (jsonb_array_length(v_estimativas) > 0)");
    expect(SQL).toContain("fechamento_estimativas = v_estimativas");
    expect(SQL).toContain("jsonb_build_object('estimativas', v_estimativas)");
    expect(SQL).toContain("'OS fechada com estimativa'");
  });

  it("os valores nas mensagens saem no formato brasileiro", () => {
    expect(SQL).toContain("public._reais(v_valor_mat)");
    expect(SQL).toContain("public._reais(v_nao_mat)");
  });
});

describe("a porta do status", () => {
  it("fechar_os abre a chave de status só para o próprio UPDATE e a fecha logo depois", () => {
    const abre = SQL.indexOf("PERFORM set_config('app.avancar_os_status', 'on', true);");
    const update = SQL.indexOf("UPDATE public.ordens_servico o SET status='concluido'");
    const fecha = SQL.indexOf("PERFORM set_config('app.avancar_os_status', '', true);");
    expect(abre).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(abre);
    expect(fecha).toBeGreaterThan(update);
  });

  it("no fechamento, os_bloqueios_para não repete as exigências de entrar em produção", () => {
    expect(SQL).toContain("AND novo_status NOT IN ('concluido', 'faturado') THEN");
    expect(SQL).toContain("p.proname = 'os_bloqueios_para'");
  });
});

describe("a coluna nova chega à tela", () => {
  it("existe na tabela, é legível por quem está logado e entra nas três visões do nível", () => {
    expect(SQL).toContain(
      "ADD COLUMN IF NOT EXISTS fechamento_estimado boolean NOT NULL DEFAULT false",
    );
    expect(SQL).toContain(
      "ADD COLUMN IF NOT EXISTS fechamento_estimativas jsonb NOT NULL DEFAULT '[]'::jsonb",
    );
    expect(SQL).toContain(
      "GRANT SELECT (fechamento_estimado, fechamento_estimativas) ON public.ordens_servico TO authenticated;",
    );
    for (const visao of [
      "ordens_servico_operacional",
      "ordens_servico_comercial",
      "ordens_servico_financeiro",
    ]) {
      expect(SQL).toContain(`'${visao}'`);
    }
  });

  it("as opções das visões voltam junto (a comercial é DEFINER por desenho)", () => {
    expect(SQL).toContain("array_to_string(alvo.reloptions, ', ')");
  });

  it("a tela da OS avisa que a margem real é a prevista", () => {
    const tela = readFileSync(
      join(__dirname, "..", "src/routes/_authenticated/os.$id.tsx"),
      "utf8",
    );
    expect(tela).toContain("os.fechamento_estimado &&");
    expect(tela).toContain('label="Fechada com estimativa"');
  });

  it("o diálogo de finalizar conta o que foi estimado", () => {
    const dialogo = readFileSync(
      join(__dirname, "..", "src/components/os/finalizar-os-dialog.tsx"),
      "utf8",
    );
    expect(dialogo).toContain("estimativas?: string[]");
    expect(dialogo).toContain("Fechada com estimativa");
  });
});

describe("todo código que a função devolve tem rótulo na tela", () => {
  it("nenhum bloqueio chega cru ao vendedor", () => {
    const codigos = new Set<string>();
    for (const m of SQL.matchAll(/'"([a-z_]+)"'::jsonb/g)) codigos.add(m[1]);
    for (const m of SQL.matchAll(/'\["([a-z_]+)"\]'::jsonb/g)) codigos.add(m[1]);
    expect(codigos.size).toBeGreaterThanOrEqual(8);
    const sem = [...codigos].filter((c) => !(c in ROTULO_BLOQUEIO));
    expect(sem, `códigos sem rótulo: ${sem.join(", ")}`).toEqual([]);
  });

  it("os dois códigos novos dizem o que fazer", () => {
    expect(rotuloBloqueio("peca_nao_saiu")).toContain("registre a retirada ou a entrega");
    expect(rotuloBloqueio("sem_custo_previsto")).toContain("informe o custo");
  });
});
