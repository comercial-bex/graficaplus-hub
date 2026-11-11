import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261110100000_aviso_no_grupo_da_equipe.sql", "utf8");
const ENVIO = readFileSync("supabase/functions/process-automations/index.ts", "utf8");

// Cópia da regra do envio: grupo segue como veio, pessoa vira só dígitos.
const destinoDoWhatsapp = (d: string) =>
  /^\d{10,}-group$/.test(d.trim()) ? d.trim() : d.trim().replace(/\D/g, "");

describe("aviso no grupo de WhatsApp da equipe", () => {
  it("o envio não estraga o endereço do grupo e continua limpando telefone de pessoa", () => {
    expect(ENVIO).toContain("const destino = destinoDoWhatsapp(item.destinatario");
    expect(ENVIO).toContain("/^\\d{10,}-group$/");
    expect(destinoDoWhatsapp("120363431862625987-group")).toBe("120363431862625987-group");
    expect(destinoDoWhatsapp("(96) 99142-3082")).toBe("96991423082");
    expect(destinoDoWhatsapp("123-group")).toBe("123");
  });

  it("a fila aceita grupo antes de normalizar telefone", () => {
    expect(SQL).toMatch(/p_canal='whatsapp' AND btrim\(p_destinatario\) ~ '\^\\d\{10,\}-group\$' THEN btrim\(p_destinatario\)/);
    expect(SQL).toContain("'whatsapp_atendimento'::text, 'lead'::text");
  });

  it("nasce desligado: só liga depois da função de envio nova estar no ar", () => {
    expect(SQL).toContain("grupo_equipe_ativo boolean NOT NULL DEFAULT false");
    expect(SQL).toContain("WHERE grupo_equipe_ativo AND grupo_equipe_id");
    expect(SQL).not.toMatch(/SET\s+grupo_equipe_ativo\s*=\s*true/i);
    expect(SQL).toContain("'120363431862625987-group'");
  });

  it("avisa atendimento aberto e lead lançado à mão, uma vez só cada", () => {
    expect(SQL).toContain("AFTER INSERT ON public.whatsapp_atendimentos");
    expect(SQL).toContain("AFTER INSERT ON public.leads");
    expect(SQL).toContain("'grupo_equipe:atendimento:' || NEW.id");
    expect(SQL).toContain("'grupo_equipe:lead:' || NEW.id");
    expect(SQL).toContain("lower(COALESCE(NEW.origem, '')) = 'whatsapp'");
  });

  it("mensagem da equipe não vira aviso; parceiro (revenda) vira", () => {
    expect(SQL).toContain("r.role::text <> 'parceiro'");
  });

  it("o aviso nunca impede o atendimento ou o lead de nascer", () => {
    expect(SQL.match(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/g)).toHaveLength(2);
  });

  it("o tipo novo aparece com nome nas telas de avisos", () => {
    for (const f of [
      "src/components/avisos/avisos-enviados.tsx",
      "src/routes/_authenticated/avisos.tsx",
      "src/routes/_authenticated/whatsapp-monitor.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).toContain('aviso_grupo_equipe: "Aviso no grupo da equipe"');
    }
  });
});
