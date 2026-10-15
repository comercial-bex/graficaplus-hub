import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  caminhoDoComprovante,
  fraseDaMargem,
  hojeNaCasa,
  lerValor,
  motivoParaNaoDecidir,
  precisaDeMotivo,
  rotuloDaCategoria,
  sextaDoPagamento,
  CATEGORIAS_DA_OS,
} from "../src/domain/financeiro/reembolsos";
import { getRoutePermissions, rolePermissions } from "../src/lib/permissions";
import { FORA_DO_MENU, urlsDaArvore } from "../src/lib/menu";

/**
 * Reembolso (15/10/2026). O dono: "o colaborador comprou algo e precisa de
 * reembolso — só que eu tenho que vincular a quem foi comprado… senão a pessoa
 * pede R$ 15 de uma sacola sendo que, pelo mesmo produto, eu ganhei centavos."
 * Decisões: semáforo (verde financeiro; amarelo/vermelho gerência), paga toda
 * sexta, foto sempre.
 *
 * As regras moram no banco e foram ensaiadas lá (rollback): sacola de R$ 15 na
 * OS #167 verde (margem 28,2% → 26,2%), a fita de R$ 60 depois amarela (a
 * Cibele é barrada, o Yvens aprova), OS sem custo amarela, repetido, sem foto e
 * o próprio barrados, foto na pasta de outro negada, conta da sexta de
 * R$ 87,50 e, paga a conta, os reembolsos pagos. Aqui: o espelho da tela.
 */

const MIGRACAO = readFileSync("supabase/migrations/20261015140000_reembolsos.sql", "utf8");
const NOMES = readFileSync("supabase/migrations/20261015150000_nomes_da_equipe.sql", "utf8");

describe("a foto do cupom", () => {
  it("mora na pasta de quem pede — o formato que o banco e o Storage conferem", () => {
    const c = caminhoDoComprovante("1c72900c-aaaa-bbbb-cccc-000000000000", "Cupom da Papelaria (1).JPG", 1760500000000);
    expect(c).toBe("reembolsos/1c72900c-aaaa-bbbb-cccc-000000000000/1760500000000_Cupom-da-Papelaria-1.jpg");
    expect(MIGRACAO).toContain("!~ ('^reembolsos/' || v_uid::text || '/')");
    expect(MIGRACAO).toContain("(storage.foldername(name))[2] = (SELECT auth.uid())::text");
  });

  it("sem foto não há reembolso: o banco confere que o arquivo chegou", () => {
    expect(MIGRACAO).toMatch(/NOT EXISTS \(SELECT 1 FROM storage\.objects WHERE bucket_id = 'arquivos-clientes' AND name = p_comprovante_path\)/);
  });
});

describe("a sexta do pagamento (mesma conta do banco)", () => {
  it("de segunda a quinta, a sexta da semana; na sexta, a própria; sábado e domingo, a próxima", () => {
    expect(sextaDoPagamento("2026-10-12")).toBe("2026-10-16"); // segunda
    expect(sextaDoPagamento("2026-10-15")).toBe("2026-10-16"); // quinta (o ensaio)
    expect(sextaDoPagamento("2026-10-16")).toBe("2026-10-16"); // sexta
    expect(sextaDoPagamento("2026-10-17")).toBe("2026-10-23"); // sábado
    expect(sextaDoPagamento("2026-10-18")).toBe("2026-10-23"); // domingo
    expect(sextaDoPagamento("2026-12-31")).toBe("2027-01-01"); // vira o ano
    expect(MIGRACAO).toContain("v_sexta := v_hoje + ((5 - extract(isodow FROM v_hoje)::int + 7) % 7);");
  });

  it("hoje é hoje em Macapá: 02:30 UTC de 16/10 ainda é 15/10 lá", () => {
    expect(hojeNaCasa(new Date("2026-10-16T02:30:00Z"))).toBe("2026-10-15");
  });
});

describe("o valor digitado", () => {
  it("aceita vírgula, ponto decimal, milhar e R$", () => {
    expect(lerValor("15,50")).toBe(15.5);
    expect(lerValor("15.50")).toBe(15.5);
    expect(lerValor("R$ 1.234,56")).toBe(1234.56);
    expect(lerValor("60")).toBe(60);
  });
  it("vazio, zero, negativo e lixo viram nada — nunca R$ 0", () => {
    for (const t of ["", "0", "0,00", "-5", "abc", "1,2,3", "15,555"]) expect(lerValor(t), t).toBeNull();
  });
});

describe("quem decide (espelho de reembolso_decidir)", () => {
  const cibele = { uid: "cib", aprovaTudo: false, aprovaVerde: true, ehAdmin: false };
  const yvens = { uid: "yv", aprovaTudo: true, aprovaVerde: false, ehAdmin: false };
  const harison = { uid: "har", aprovaTudo: true, aprovaVerde: true, ehAdmin: true };
  const leonardo = { uid: "leo", aprovaTudo: false, aprovaVerde: false, ehAdmin: false };
  const pedido = (cor: "verde" | "amarelo" | "vermelho" | "empresa", de = "leo") =>
    ({ status: "aguardando", cor, solicitante_id: de }) as const;

  it("o financeiro aprova o verde e a despesa da empresa; o amarelo e o vermelho são da gerência", () => {
    expect(motivoParaNaoDecidir(pedido("verde"), cibele)).toBeNull();
    expect(motivoParaNaoDecidir(pedido("empresa"), cibele)).toBeNull();
    expect(motivoParaNaoDecidir(pedido("amarelo"), cibele)).toMatch(/gerência/);
    expect(motivoParaNaoDecidir(pedido("vermelho"), cibele)).toMatch(/gerência/);
    for (const cor of ["verde", "amarelo", "vermelho", "empresa"] as const)
      expect(motivoParaNaoDecidir(pedido(cor), yvens), cor).toBeNull();
  });

  it("quem pediu não aprova o próprio — o administrador pode", () => {
    expect(motivoParaNaoDecidir(pedido("verde", "cib"), cibele)).toMatch(/próprio/);
    expect(motivoParaNaoDecidir(pedido("amarelo", "yv"), yvens)).toMatch(/próprio/);
    expect(motivoParaNaoDecidir(pedido("vermelho", "har"), harison)).toBeNull();
    expect(MIGRACAO).toContain("IF v_r.solicitante_id = v_uid AND NOT public.has_role(v_uid, 'admin') THEN");
  });

  it("quem só pede não decide; decidido não volta", () => {
    expect(motivoParaNaoDecidir(pedido("verde"), leonardo)).toMatch(/não decide/);
    expect(motivoParaNaoDecidir({ ...pedido("verde"), status: "aprovado" }, yvens)).toMatch(/já foi decidido/);
  });

  it("recusar sempre pede motivo; aprovar o prejuízo também", () => {
    expect(precisaDeMotivo(false, "verde")).toBe(true);
    expect(precisaDeMotivo(true, "vermelho")).toBe(true);
    expect(precisaDeMotivo(true, "amarelo")).toBe(false);
    expect(precisaDeMotivo(true, "verde")).toBe(false);
    expect(MIGRACAO).toContain("IF (NOT p_aprovar OR v_cor = 'vermelho') AND coalesce(btrim(p_motivo), '') = '' THEN");
  });
});

describe("o semáforo no banco", () => {
  it("margem mínima da casa (20%), prejuízo e OS sem custo", () => {
    expect(MIGRACAO).toContain("ELSIF v_margem_depois < 0.20 THEN");
    expect(MIGRACAO).toContain("IF v_margem_depois < 0 THEN");
    expect(MIGRACAO).toContain("O custo desta OS é desconhecido");
  });

  it("reembolso soma ao previsto (não some atrás dele) e os pedidos anteriores contam — por ordem de chegada", () => {
    // Os dois defeitos que o ensaio pegou: a sacola aprovada sumia atrás dos
    // R$ 534,95 previstos; e a fita pedida DEPOIS deixava a sacola amarela.
    expect(MIGRACAO).toMatch(/greatest\(coalesce\(v_previsto, 0\), coalesce\(v_lancado, 0\) - v_reembolsado\)\s+\+ v_reembolsado \+ v_pendente/);
    expect(MIGRACAO).toContain("OR created_at < (SELECT r0.created_at FROM public.reembolsos r0 WHERE r0.id = p_ignorar)");
  });

  it("a margem só vai para quem decide ou vê o financeiro (margem é custo disfarçado)", () => {
    expect(MIGRACAO).toMatch(/v_ve_numeros := public\.has_permission\(v_uid, 'reembolsos\.approve'\)\s+OR public\.has_permission\(v_uid, 'reembolsos\.pay'\)\s+OR public\.can_see_financials\(v_uid\)/);
    expect(fraseDaMargem({ margem_antes: 28.2, margem_depois: 26.2, custo_conhecido: true })).toBe(
      "Margem da OS: 28,2% → 26,2%",
    );
    expect(fraseDaMargem({ margem_antes: 100, margem_depois: 98, custo_conhecido: false })).toMatch(/desconhecido/);
    // Para quem só pede, o banco não manda número: a frase some.
    expect(fraseDaMargem({ custo_conhecido: undefined })).toBeNull();
  });
});

describe("a porta do banco", () => {
  it("a tabela só se lê; escrever é pelas funções", () => {
    expect(MIGRACAO).toContain("REVOKE ALL ON public.reembolsos FROM PUBLIC, anon, authenticated;");
    expect(MIGRACAO).toContain("GRANT SELECT ON public.reembolsos TO authenticated;");
  });

  it("as funções fechadas para anon, abertas para quem entra", () => {
    for (const f of [
      "reembolso_semaforo(uuid, numeric, uuid)",
      "reembolso_pedir(numeric, text, date, text, text, text, uuid, uuid, text)",
      "reembolso_decidir(uuid, boolean, text)",
      "reembolso_cancelar(uuid)",
    ]) {
      expect(MIGRACAO).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon;`);
      expect(MIGRACAO).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated, service_role;`);
    }
    expect(NOMES).toContain("REVOKE ALL ON FUNCTION public.nomes_da_equipe(uuid[]) FROM PUBLIC, anon;");
  });

  it("aprovar vira custo real da OS e soma na conta da sexta de cada pessoa; pagar a conta paga os reembolsos", () => {
    expect(MIGRACAO).toContain("'reembolso', 1, v_r.valor");
    expect(MIGRACAO).toContain("cp.categoria = 'reembolso' AND cp.vencimento = v_sexta");
    expect(MIGRACAO).toMatch(/AFTER UPDATE OF status ON public\.contas_pagar/);
    expect(MIGRACAO).toContain("WHERE conta_pagar_id = NEW.id AND status = 'aprovado';");
  });

  it("o nome de quem é da equipe só sai id e nome, e só para a equipe", () => {
    expect(NOMES).toContain("RETURNS TABLE(id uuid, nome text)");
    expect(NOMES).toContain("WHERE public.is_staff(auth.uid())");
  });
});

describe("as telas e o menu", () => {
  it("a mesa de quem decide e o pedido de cada pessoa têm portas diferentes", () => {
    expect(getRoutePermissions("/reembolsos")).toEqual(["reembolsos.pay", "reembolsos.approve"]);
    expect(getRoutePermissions("/meus-reembolsos")).toEqual(["reembolsos.request"]);
    expect(urlsDaArvore()).toContain("/reembolsos");
    expect(urlsDaArvore()).not.toContain("/meus-reembolsos");
    expect(FORA_DO_MENU["/meus-reembolsos"].titulo).toBe("Meus reembolsos");
  });

  it("toda a equipe pede; o financeiro e a gerência decidem (reserva igual ao banco)", () => {
    for (const papel of ["admin", "gestor", "financeiro", "vendedor", "designer", "operador", "estoque", "instalador"] as const)
      expect(rolePermissions[papel] as readonly string[], papel).toContain("reembolsos.request");
    expect(rolePermissions.financeiro as readonly string[]).toContain("reembolsos.pay");
    expect(rolePermissions.gestor as readonly string[]).toContain("reembolsos.approve");
    expect(rolePermissions.cliente as readonly string[]).not.toContain("reembolsos.request");
    expect(rolePermissions.parceiro as readonly string[]).not.toContain("reembolsos.request");
    for (const linha of [
      "('admin', 'reembolsos.request')", "('operador', 'reembolsos.request')", "('instalador', 'reembolsos.request')",
      "('financeiro', 'reembolsos.pay')", "('gestor', 'reembolsos.approve')",
    ])
      expect(MIGRACAO).toContain(linha);
  });

  it("as categorias da tela são as que o banco aceita para OS", () => {
    expect(CATEGORIAS_DA_OS.map((c) => c.valor)).toEqual([
      "material", "embalagem", "acabamento", "logistica", "terceiros", "retrabalho",
    ]);
    expect(MIGRACAO).toContain("IF p_categoria NOT IN ('material', 'embalagem', 'acabamento', 'logistica', 'terceiros', 'retrabalho') THEN");
    expect(rotuloDaCategoria("despesa_geral")).toBe("Despesa da empresa");
  });

  it("a tela nunca escreve na tabela: pede, decide e cancela pelas funções", () => {
    const fontes = [
      "src/components/reembolsos/pedir-reembolso.tsx",
      "src/components/reembolsos/lista.tsx",
      "src/components/reembolsos/dados.ts",
      "src/routes/_authenticated/meus-reembolsos.tsx",
      "src/routes/_authenticated/reembolsos.tsx",
    ].map((f) => readFileSync(f, "utf8"));
    for (const f of fontes) expect(f).not.toMatch(/from\("reembolsos"\)\s*\.(insert|update|upsert|delete)/);
    const tudo = fontes.join("\n");
    for (const rpc of ["reembolso_pedir", "reembolso_decidir", "reembolso_cancelar", "reembolso_semaforo"])
      expect(tudo).toContain(`rpc("${rpc}"`);
  });

  it("quem fez: o Quadro e o histórico da OS leem o nome por nomes_da_equipe, não por `usuarios`", () => {
    const os = readFileSync("src/routes/_authenticated/os.$id.tsx", "utf8");
    const kanban = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
    expect(os).toContain("nomes: await nomesDaEquipe(");
    expect(os).not.toMatch(/from\("usuarios"\)\.select\("id, nome"\)\.in\("id", ids\)/);
    expect(kanban).toContain("await nomesDaEquipe(");
  });
});
