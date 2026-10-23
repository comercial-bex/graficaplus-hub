import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * OS interna (23/10/2026, onda 2 do plano): amostra, vitrine, mostruário, uso
 * interno e reposição. Ensaio com rollback abrindo um banner de mostruário 2×1 m
 * como o dono: finalidade mostruário, valor 0, custo previsto R$ 29,00, 2 m² de
 * lona e 1 kit reservados, máquina agendada; 0 conta a receber, 0 pós-venda, 0
 * aviso, 0 envio; o fechamento só barra pelo que é legítimo. A numeração da OS
 * foi restaurada no mesmo comando.
 */

const SQL = readFileSync("supabase/migrations/20261023100000_os_interna_finalidade.sql", "utf8");
const DIALOGO = readFileSync("src/components/os/nova-os-interna.tsx", "utf8");
const LISTA = readFileSync("src/routes/_authenticated/os.index.tsx", "utf8");

describe("o banco", () => {
  it("finalidade com quatro valores, venda por padrão (nada muda no que já existe)", () => {
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS finalidade text NOT NULL DEFAULT 'venda'");
    expect(SQL).toContain("CHECK (finalidade IN ('venda', 'mostruario', 'uso_interno', 'reposicao'))");
  });

  it("o que não é venda não avisa o cliente, não abre pós-venda e não dispara automação", () => {
    expect(SQL).toContain("tg_os_notificar_cliente");
    expect(SQL).toContain("trg_os_pos_venda");
    expect(SQL).toContain("tg_automacao_os_eventos");
    expect(SQL).toContain("NEW.finalidade <> ''venda'' THEN RETURN NEW;");
    expect(SQL).toContain("NEW.finalidade = ''venda''");
    expect(SQL).toContain("o4.finalidade FROM public.ordens_servico o4 WHERE o4.id = fechar_os.os_id) = ''venda''");
  });

  it("todas as edições são ancoradas no corpo vivo: âncora fora do esperado para a migração", () => {
    expect(SQL.match(/IF n <> 1 THEN RAISE EXCEPTION/g)).toHaveLength(4);
  });

  it("a leitura da finalidade é por uma view pequena (recriar as views grandes descarta as opções)", () => {
    expect(SQL).toContain("CREATE OR REPLACE VIEW public.os_finalidade_v");
    expect(SQL).toContain("ALTER VIEW public.os_finalidade_v SET (security_invoker = false, security_barrier = true);");
  });

  it("qualquer pessoa da equipe abre; visitante não; reposição exige a OS de origem", () => {
    expect(SQL).toContain("NOT public.is_staff(v_uid)");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.criar_os_interna(text, text, uuid, numeric, text, numeric, numeric, text, uuid) FROM PUBLIC, anon;");
    expect(SQL).toContain("Reposição precisa da OS que está sendo refeita.");
  });

  it("não cria conta a receber nem passa pela conversão; reserva material e agenda a máquina", () => {
    const f = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.criar_os_interna"));
    expect(f).not.toContain("contas_receber");
    expect(f).toContain("public.reservar_materiais_os_interno(v_os, v_uid)");
    expect(f).toContain("public.agendar_os_interno(v_os)");
  });
});

describe("a tela", () => {
  it("o diálogo abre pela função do banco, trava o segundo toque e leva à OS", () => {
    expect(DIALOGO).toContain('rpc as any)("criar_os_interna"');
    expect(DIALOGO).toContain("if (gravandoRef.current) return;");
    expect(DIALOGO).toContain('navigate({ to: "/os/$id", params: { id: r.os_id } })');
  });

  it("produto por m² pede a medida em cm; serviço não entra", () => {
    expect(DIALOGO).toContain("ehUnidadeDeArea(produto.unidade)");
    expect(DIALOGO).toContain('p.tipo !== "servico"');
  });

  it("a lista mostra o selo, o filtro e não oferece o cliente da casa para venda", () => {
    expect(LISTA).toContain("<NovaOsInterna />");
    expect(LISTA).toContain('.eq("interno", false)');
    expect(LISTA).toContain('.from("os_finalidade_v")');
    expect(LISTA).toContain("ROTULO_DA_FINALIDADE[finalidades.get(o.id)!.finalidade]");
  });
});
