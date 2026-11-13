import { describe, expect, it } from "vitest";
import { MIGRACAO_B3, corpoDaFuncao, grants, lerMigracao, semComentarios } from "./triagem/sql-lido-como-texto";
import { diasEmTexto, horarioEmTexto, dentroDoHorario, HORARIO_SEMENTE } from "../src/domain/whatsapp/triagem/horario";
import { dentroDoHorario as dentroDoHorarioAntigo } from "../src/domain/whatsapp/assistente";

/**
 * B3 da triagem (Onda B): horário de atendimento numa porta só, lida como texto.
 * Trava: tabelas com RLS, função no fuso de Belém igual à regra do TypeScript e à regra antiga da assistente,
 * texto de dias e de horas igual ao do código, nenhuma função viva alterada, só service_role executa.
 */
const BRUTO = lerMigracao(MIGRACAO_B3);
const SQL = semComentarios(BRUTO);

const TABELAS = ["whatsapp_horarios_atendimento", "whatsapp_feriados"];
const FUNCOES = [
  "whatsapp_dentro_do_horario",
  "_whatsapp_hora_em_texto",
  "_whatsapp_dias_em_texto",
  "whatsapp_horario_em_texto",
  "whatsapp_horario_salvar",
  "whatsapp_feriado_salvar",
  "tg_whatsapp_config_sincroniza_horario",
];

describe("horário único: migração", () => {
  it("é transacional, tem precondição e termina com a conferência", () => {
    expect(SQL).toMatch(/^\s*BEGIN;/m);
    expect(SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(SQL).toContain("DO $pre$");
    expect(SQL).toContain("DO $conferencia$");
    expect(SQL.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(15);
  });

  it("não fala a palavra proibida do dono nem manda mensagem", () => {
    expect(BRUTO).not.toMatch(/revendedor/i);
    expect(SQL).not.toMatch(/notificacoes_fila|whatsapp_fila_envio|whatsapp_mensagens|net\.http/i);
  });

  it("só cria tabela de feriado se não existir nenhuma, e as duas tabelas têm RLS", () => {
    expect(SQL).toContain("já existe uma tabela de feriado ou calendário");
    for (const t of TABELAS) {
      expect(SQL, t).toContain(`CREATE TABLE public.${t} (`);
      expect(SQL, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL, t).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(SQL, t).toContain(`GRANT SELECT ON public.${t} TO authenticated;`);
      expect(SQL, t).toContain(`GRANT ALL ON public.${t} TO service_role;`);
    }
    const politicas = [...SQL.matchAll(/CREATE POLICY "([^"]+)" ON public\.(\w+)\s+FOR (\w+) TO (\w+)/g)];
    expect(politicas.map((p) => p[3])).toEqual(["SELECT", "SELECT"]);
  });

  it("fuso fixo de Belém e a mesma regra do TypeScript: abre inclusive, fecha exclusivo, feriado vence", () => {
    const c = corpoDaFuncao(SQL, "whatsapp_dentro_do_horario");
    expect(c).toContain("AT TIME ZONE 'America/Belem'");
    expect(c).toContain("extract(dow FROM v_local)");
    expect(c).toContain("v_hora >= h.abre AND v_hora < h.fecha");
    expect(c).toContain("v_hora >= f.abre AND v_hora < f.fecha");
    expect(c.indexOf("whatsapp_feriados")).toBeLessThan(c.indexOf("whatsapp_horarios_atendimento"));
    expect(c).toContain("STABLE SECURITY DEFINER");
    expect(c).toContain("SET search_path TO 'public'");
  });

  it("a semente copia o horário antigo e deixa sábado e domingo inativos quando a tela antiga não os marcou", () => {
    expect(SQL).toContain("(CASE WHEN d = 0 THEN 7 ELSE d END) = ANY (c.dias_semana)");
    expect(SQL).toContain("FROM public.whatsapp_configuracoes");
    // sem linha antiga: segunda a sexta, 8h às 18h
    expect(SQL).toContain("d BETWEEN 1 AND 5");
    expect(SQL).toContain("time '08:00', time '18:00'");
    expect(HORARIO_SEMENTE.semana.filter((d) => d.ativo).map((d) => d.diaSemana)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a tela antiga continua intacta: nenhuma função viva é recriada, só há um gatilho que COPIA quando o horário muda de verdade", () => {
    expect(SQL).not.toMatch(/FUNCTION public\.whatsapp_salvar_configuracoes/);
    expect(SQL).not.toMatch(/ALTER TABLE public\.whatsapp_configuracoes/);
    expect(SQL).not.toMatch(/\b(INSERT INTO|DELETE FROM)\s+public\.whatsapp_configuracoes/);
    expect(SQL).toContain("CREATE TRIGGER tg_whatsapp_config_sincroniza_horario");
    expect(SQL).toContain("WHEN (OLD.horario_inicio IS DISTINCT FROM NEW.horario_inicio");
    expect(SQL).toContain("OR OLD.dias_semana IS DISTINCT FROM NEW.dias_semana");
    // o legado usa dia ISO (7 = domingo); a tabela nova usa 0 = domingo
    expect(corpoDaFuncao(SQL, "tg_whatsapp_config_sincroniza_horario")).toContain("CASE WHEN h.dia_semana = 0 THEN 7 ELSE h.dia_semana END");
  });

  it("o gatilho FAZ trabalho e nunca trava o salvamento da tela: erro vira RAISE WARNING, e a migração diz isso com todas as letras", () => {
    const g = corpoDaFuncao(SQL, "tg_whatsapp_config_sincroniza_horario");
    expect(g).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(g).toContain("RAISE WARNING 'tg_whatsapp_config_sincroniza_horario falhou, o salvamento segue");
    expect(g).toContain("RETURN NULL");
    // o UPDATE da tabela nova está DENTRO do bloco protegido
    const segundoBegin = g.indexOf("BEGIN", g.indexOf("BEGIN") + 1);
    expect(segundoBegin).toBeGreaterThan(0);
    expect(g.indexOf("UPDATE public.whatsapp_horarios_atendimento")).toBeGreaterThan(segundoBegin);
    expect(g.indexOf("UPDATE public.whatsapp_horarios_atendimento")).toBeLessThan(g.indexOf("EXCEPTION WHEN OTHERS"));
    // o cabeçalho avisa que o gatilho reescreve os 7 dias e que ele sai no B5
    expect(BRUTO).toContain("UM GATILHO DESTA MIGRAÇÃO FAZ TRABALHO DE VERDADE");
    expect(BRUTO).toContain("REESCREVE os 7 dias de whatsapp_horarios_atendimento");
    expect(BRUTO).toContain("até o PR B5 removê-lo");
    expect(BRUTO).toMatch(/NÃO é "sem comportamento\s*--\s*novo" neste ponto/);
    // a conferência final falha se o bloco protegido sumir
    expect(SQL).toContain("o gatilho de sincronização precisa capturar erro e virar aviso, sem travar o salvamento da tela");
  });

  it("a conferência compara a função nova com a regra antiga em 49 momentos", () => {
    expect(SQL).toContain("generate_series(date '2026-11-16', date '2026-11-22', interval '1 day')");
    expect(SQL).toContain("ARRAY['00:00', '07:59', '08:00', '12:00', '17:59', '18:00', '23:59']");
    expect(SQL).toContain("v_comparados <> 49");
    expect(SQL).toContain("extract(isodow FROM");
  });

  it("ACL: tudo service_role, nada para anon, authenticated ou PUBLIC; uma assinatura por nome", () => {
    for (const f of FUNCOES) {
      expect(SQL, f).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(SQL, f).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`));
      expect(SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${f}\\(`, "g"))?.length, f).toBe(1);
    }
    const criadas = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(criadas).toEqual([...FUNCOES].sort());
    for (const g of grants(SQL)) {
      expect(g.para).not.toContain("anon");
      expect(g.para).not.toContain("public");
      if (g.para.includes("authenticated")) expect(g.alvo).toMatch(/^SELECT ON public\.whatsapp_(horarios_atendimento|feriados)$/);
      if (/^EXECUTE/.test(g.alvo)) expect(g.para).toEqual(["service_role"]);
    }
  });

  it("as funções de escrita conferem a permissão de quem pediu e são definer com search_path", () => {
    for (const f of ["whatsapp_horario_salvar", "whatsapp_feriado_salvar"]) {
      const c = corpoDaFuncao(SQL, f);
      expect(c, f).toContain("SECURITY DEFINER");
      expect(c, f).toContain("SET search_path TO 'public'");
      expect(c, f).toContain("public.has_permission(p_usuario, 'whatsapp.manage')");
      expect(c, f).toContain("public.has_permission(p_usuario, 'configuracoes.manage')");
    }
  });
});

describe("horário único: o texto do banco é o texto do código", () => {
  it("dias em texto", () => {
    expect(diasEmTexto([1, 2, 3, 4, 5])).toBe("de segunda a sexta");
    expect(diasEmTexto([1, 3, 5])).toBe("segunda, quarta e sexta");
    expect(diasEmTexto([6])).toBe("aos sábados");
    expect(diasEmTexto([1, 2, 3, 4, 5, 6])).toBe("de segunda a sábado");
    // os mesmos quatro valores que a conferência do SQL exige
    expect(SQL).toContain("<> 'de segunda a sexta'");
    expect(SQL).toContain("<> 'segunda, quarta e sexta'");
    expect(SQL).toContain("<> 'aos sábados'");
    expect(SQL).toContain("<> 'de segunda a sábado'");
  });

  it("horas e variáveis do texto", () => {
    expect(horarioEmTexto(HORARIO_SEMENTE)).toEqual({ abre: "8h", fecha: "18h", dias: "de segunda a sexta" });
    expect(SQL).toContain("public._whatsapp_hora_em_texto(time '08:00') <> '8h'");
    expect(SQL).toContain("public._whatsapp_hora_em_texto(time '12:30') <> '12h30'");
    const c = corpoDaFuncao(SQL, "whatsapp_horario_em_texto");
    // agrupa por horário: o grupo com mais dias manda em abre e fecha, os outros entram em dias
    expect(c).toContain("GROUP BY h.abre, h.fecha");
    expect(c).toContain("ORDER BY count(*) DESC, bool_or(h.dia_semana BETWEEN 1 AND 5) DESC, min(h.dia_semana)");
    expect(c).toContain("NOT (h.abre = v_prim.abre AND h.fecha = v_prim.fecha)");
    expect(c).toContain("'abre'");
    expect(c).toContain("'fecha'");
    expect(c).toContain("'dias'");
  });

  it("a regra nova no TypeScript dá o mesmo que a regra antiga da assistente em todos os 49 momentos da conferência", () => {
    const antigo = { horario_inicio: "08:00", horario_fim: "18:00", dias_semana: [1, 2, 3, 4, 5] };
    const dias = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
    let n = 0;
    for (const dia of dias) {
      for (const hm of ["00:00", "07:59", "08:00", "12:00", "17:59", "18:00", "23:59"]) {
        const momento = new Date(`${dia}T${hm}:00-03:00`);
        expect(dentroDoHorario(momento, HORARIO_SEMENTE), `${dia} ${hm}`).toBe(dentroDoHorarioAntigo(antigo, momento));
        n++;
      }
    }
    expect(n).toBe(49);
  });

  it("feriado fechado vence a semana, feriado com horário próprio vale no lugar dela", () => {
    const segunda10h = new Date("2026-11-16T10:00:00-03:00");
    expect(dentroDoHorario(segunda10h, { ...HORARIO_SEMENTE, feriados: [{ data: "2026-11-16", fechado: true }] })).toBe(false);
    expect(
      dentroDoHorario(new Date("2026-11-21T10:00:00-03:00"), {
        ...HORARIO_SEMENTE,
        feriados: [{ data: "2026-11-21", fechado: false, abre: "09:00", fecha: "12:00" }],
      }),
    ).toBe(true);
  });
});
