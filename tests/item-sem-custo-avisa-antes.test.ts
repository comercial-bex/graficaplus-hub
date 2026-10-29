import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PENDENCIA_ITEM_SEM_CUSTO,
  conferenciaAntesDeConverter,
  pendenciasParaEnviar,
} from "../src/domain/orcamentos/acordo";
import { estadoDosPassosDaEquipe, passoDaPendencia } from "../src/domain/orcamentos/passos-da-equipe";

/**
 * O orçamento 153 ("3 banner", R$ 42, 29/10/2026) tinha o Pix recebido e dois itens digitados à mão como
 * "banner": sem produto do catálogo e sem custo, que o banco recusa na conversão desde 22/10. A recusa só
 * aparecia na hora de converter, com o cliente já tendo pago — e é o que explica os cinco orçamentos
 * impressos sem OS (54, 56, 57, 62 e 70). Agora a tela avisa enquanto o orçamento é montado e na
 * conferência antes de converter, com os nomes dos itens.
 */
const PASTA = "supabase/migrations";
const MIGRACAO = readFileSync(join(PASTA, "20261029600000_aviso_de_item_sem_custo_antes_da_os.sql"), "utf8");
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

const base = {
  temClienteOuContato: true,
  dataEntrega: "2026-11-05",
  verPreco: true,
  temCondicao: true,
  itens: [{ arquivo_id: "a" }],
};

describe("pendência: item fora do catálogo sem custo", () => {
  it("aparece quando o banco devolve itens barrados", () => {
    expect(pendenciasParaEnviar({ ...base, itensSemCusto: ["banner", "banner"] })).toEqual([PENDENCIA_ITEM_SEM_CUSTO]);
  });

  it("some quando não há item barrado, ou quando a tela ainda não perguntou", () => {
    expect(pendenciasParaEnviar({ ...base, itensSemCusto: [] })).toEqual([]);
    expect(pendenciasParaEnviar({ ...base })).toEqual([]);
  });

  it("se resolve no passo dos itens, e o resumo do passo diz", () => {
    expect(passoDaPendencia(PENDENCIA_ITEM_SEM_CUSTO)).toBe(2);
    const passos = estadoDosPassosDaEquipe({
      clienteNome: "Marcela",
      itens: 3,
      total: 42,
      pendencias: [PENDENCIA_ITEM_SEM_CUSTO],
      fechado: false,
    });
    expect(passos[1].resumo).toContain("item sem custo");
  });
});

describe("conferência antes de converter: o item barrado aparece com o nome", () => {
  const conf = {
    temCliente: true,
    dataEntrega: "2026-11-05",
    verPreco: true,
    forma: "PIX",
    condicaoCompleta: true,
    pixRecebido: true,
    itensSemArte: 0,
    descontoPendente: false,
  };

  it("com item barrado: linha obrigatória, com os nomes", () => {
    const linha = conferenciaAntesDeConverter({ ...conf, itensSemCusto: ["Banner com bastão e corda", "banner"] }).find(
      (i) => i.chave === "custo",
    );
    expect(linha).toBeDefined();
    expect(linha!.ok).toBe(false);
    expect(linha!.nivel).toBe("obrigatorio");
    expect(linha!.detalhe).toContain("Banner com bastão e corda; banner");
    expect(linha!.detalhe).toContain("escolha o produto ou informe o custo");
  });

  it("sem item barrado a conferência fica exatamente como era", () => {
    expect(conferenciaAntesDeConverter({ ...conf }).map((i) => i.chave)).toEqual([
      "cliente",
      "entrega",
      "pagamento",
      "pix",
      "desconto",
      "arte",
    ]);
    expect(conferenciaAntesDeConverter({ ...conf, itensSemCusto: [] }).some((i) => i.chave === "custo")).toBe(false);
  });
});

describe("a função do banco usa o critério da conversão e não vaza custo", () => {
  it("é o mesmo critério do bloco b2 de converter_orcamento_em_os", () => {
    const pastas = readdirSync(PASTA)
      .filter((nome) => nome.endsWith(".sql"))
      .sort();
    const conversao = readFileSync(
      join(
        PASTA,
        pastas.filter((nome) => readFileSync(join(PASTA, nome), "utf8").includes("FUNCTION public.converter_orcamento_em_os(")).pop() as string,
      ),
      "utf8",
    );
    for (const trecho of [
      "i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0",
      "i.origem_calculo IS DISTINCT FROM 'taxa_prazo'",
    ]) {
      expect(conversao).toContain(trecho);
      expect(MIGRACAO).toContain(trecho);
    }
  });

  it("devolve só descrições: o custo aparece no filtro, nunca no resultado", () => {
    expect(MIGRACAO).toContain("array_agg(COALESCE(NULLIF(btrim(i.descricao), ''), 'item sem descrição') ORDER BY i.ordem)");
    // o que a função devolve é a lista entre o SELECT e o FROM: sem nenhuma coluna de custo
    const lista = MIGRACAO.slice(
      MIGRACAO.indexOf("SELECT array_agg("),
      MIGRACAO.indexOf("FROM public.orcamento_itens i"),
    );
    expect(lista.length).toBeGreaterThan(0);
    expect(lista).not.toContain("custo");
  });

  it("só equipe que vê preço; anon fechado; sem login devolve vazio", () => {
    expect(MIGRACAO).toContain("IF v_uid IS NULL OR NOT public.is_staff(v_uid) OR NOT public.can_see_prices(v_uid) THEN");
    expect(MIGRACAO).toContain("RETURN ARRAY[]::text[];");
    expect(MIGRACAO).toContain("REVOKE ALL ON FUNCTION public.itens_que_impedem_a_os(uuid) FROM PUBLIC, anon;");
    expect(MIGRACAO).toContain("GRANT EXECUTE ON FUNCTION public.itens_que_impedem_a_os(uuid) TO authenticated;");
  });
});

describe("a tela pergunta ao banco e passa a lista adiante", () => {
  it("chama a função com o parâmetro certo e atualiza quando o item muda", () => {
    expect(TELA).toContain('.rpc("itens_que_impedem_a_os", { p_orcamento_id: id })');
    // a chave começa com ["orc-itens", id]: salvar ou apagar item invalida o aviso junto
    expect(TELA).toContain('queryKey: ["orc-itens", id, "sem-custo"]');
  });

  it("a lista chega à pendência de envio e à conferência antes de converter", () => {
    const envio = TELA.slice(TELA.indexOf("const pendencias = pendenciasParaEnviar({"));
    expect(envio.slice(0, 900)).toContain("itensSemCusto,");
    const conferencia = TELA.slice(TELA.indexOf("conferenciaAntesDeConverter({"));
    expect(conferencia.slice(0, 900)).toContain("itensSemCusto,");
  });

  it("a pendência leva até a lista de itens", () => {
    expect(TELA).toContain('[PENDENCIA_ITEM_SEM_CUSTO]: "itens-do-orcamento"');
  });
});
