import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Diagnóstico final de 29/10/2026, verificações 5.3 e 5.4.
 *
 * 5.3 — a busca de horário só oferece blocos de um dia (08:00 às 18:00, 600 min). O item maior que isso era
 * recusado com "agende em partes": o trabalho de dividir ficava para a pessoa. Agora vai em partes de até 240
 * min, uma depois da outra, ou nenhuma. Ensaiado no banco (transação desfeita) na OS 215 com 300 un (1 reserva
 * de 300 min), 800 un (240 + 240 + 240 + 80 em 02 e 03/11), 3.000 un (13 partes pulando o fim de semana,
 * soma 3.000) e 20.000 un (recusado: mais de 60 blocos).
 *
 * 5.4 — o aviso de OS sem horário só contava produto que já tinha máquina padrão. O novo lista o item que a
 * agenda não consegue reservar e diz o motivo (ensaio: OS 168, DTF digitado à mão; OS 214, A4 sem máquina).
 */
const SQL = readFileSync(
  join(__dirname, "..", "supabase/migrations/20261030840000_agenda_divide_o_item_grande.sql"),
  "utf8",
);

describe("o item que cabe num dia vai inteiro, como antes", () => {
  it("só procura o bloco inteiro quando ele cabe nos 600 min do expediente", () => {
    expect(SQL).toContain("IF v_min <= 600 THEN");
    expect(SQL).toContain(
      "v_inicio := public.proximo_horario_livre_interno(r.maquina_id, v_min, v_cursor);",
    );
  });
});

describe("o item que não cabe é dividido em partes", () => {
  it("partes de até 240 min, cada uma no próximo horário livre depois da anterior", () => {
    expect(SQL).toContain("v_partes := ceil(v_min / 240.0)::int;");
    expect(SQL).toContain("proximo_horario_livre_interno(r.maquina_id, LEAST(v_resto, 240), v_c)");
    expect(SQL).toContain("v_c := v_inicio + make_interval(mins => LEAST(v_resto, 240));");
  });

  it("também divide o item de até 600 min quando a máquina não tem uma folga contínua do tamanho dele", () => {
    // a divisão roda sempre que o bloco inteiro não achou lugar (v_ini_p vazio), não só acima de 600
    expect(SQL).toContain("IF cardinality(v_ini_p) = 0 THEN");
  });

  it("ou entram todas as partes, ou nenhuma", () => {
    expect(SQL).toContain("IF v_inicio IS NULL THEN v_ok := false; EXIT; END IF;");
    expect(SQL).toContain("IF NOT v_ok THEN");
    expect(SQL).toContain("'sem horário livre nos próximos 90 dias nesta máquina'");
  });

  it("o pedido absurdo (mais de 60 blocos de 4 h) é recusado dizendo quanto precisa", () => {
    expect(SQL).toContain("IF v_partes > 60 THEN");
    expect(SQL).toContain("'precisa de ' || v_min || ' min de máquina (mais de 60 blocos de 4 h)");
  });

  it("cada parte é uma reserva com os minutos dela e o título diz qual parte é", () => {
    expect(SQL).toContain("' (parte ' || v_parte || '/' || v_partes || ')'");
    expect(SQL).toContain("v_min_p[v_parte], 'agendado', 'os'");
    expect(SQL).toContain("'parte', v_parte, 'partes', v_partes");
  });

  it("o próximo item começa depois da última parte", () => {
    expect(SQL).toContain(
      "v_cursor := v_ini_p[v_partes] + make_interval(mins => v_min_p[v_partes]);",
    );
  });

  it("não mexe nas contas de minutos: área, velocidade, setup e mínimo seguem iguais", () => {
    expect(SQL).toContain("v_min := ceil((r.area_cobrada / r.velocidade_m2_h) * 60)::int;");
    expect(SQL).toContain(
      "v_min := GREATEST(v_min + COALESCE(r.setup_min, 0), COALESCE(r.tempo_minimo_min, 0), 1);",
    );
    expect(SQL).toContain("lower(replace(COALESCE(r.unidade_produto, ''), '²', '2')) = 'm2'");
  });
});

describe("a tela conta qual parte é", () => {
  it("a lista de reservas criadas mostra 'parte 2 de 4' quando o item veio dividido", () => {
    const tela = readFileSync(
      join(__dirname, "..", "src/routes/_authenticated/os.$id.tsx"),
      "utf8",
    );
    expect(tela).toContain("parte?: number;");
    expect(tela).toContain("(parte ${r.parte} de ${r.partes})");
  });
});

describe("o aviso do item que a agenda não consegue reservar", () => {
  it("diz o motivo de cada item: sem produto, sem máquina padrão ou sem tempo", () => {
    expect(SQL).toContain("'item_sem_maquina_ou_tempo'");
    expect(SQL).toContain("'item digitado à mão, sem produto do catálogo'");
    expect(SQL).toContain("'produto sem máquina padrão'");
    expect(SQL).toContain("'produto sem tempo de produção'");
  });

  it("deixa de fora o que não se agenda de propósito: serviço, taxa, terceirizado, 3D e OS que já tem reserva", () => {
    expect(SQL).toContain("COALESCE(p.tipo::text, 'produto') <> 'servico'");
    expect(SQL).toContain("!~* '(terceiriz|^taxa)'");
    expect(SQL).toContain("producao_3d_jobs");
    expect(SQL).toContain("a.status IN ('agendado', 'em_producao', 'concluido')");
  });

  it("máquina com velocidade e área cobrada reserva pela velocidade, então não é 'sem tempo'", () => {
    expect(SQL).toContain(
      "NOT (COALESCE(m.velocidade_m2_h, 0) > 0 AND COALESCE(i.area_cobrada, 0) > 0)",
    );
  });

  it("só olha OS de venda antes de ficar pronta (depois de pronta não precisa mais de horário)", () => {
    expect(SQL).toContain("'entrada','aguardando_briefing','briefing_ok','design'");
    expect(SQL).not.toContain("'aguardando_retirada'");
  });

  it("é seguro de reaplicar e para se a âncora mudou", () => {
    expect(SQL).toContain("IF position('item_sem_maquina_ou_tempo' IN v_def) = 0 THEN");
    expect(SQL).toContain("RAISE EXCEPTION 'pendencias_do_sistema: esperava 1 âncora, achei %'");
  });
});
