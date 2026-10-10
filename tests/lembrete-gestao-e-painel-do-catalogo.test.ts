import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGO, TELEFONE_DOS_GESTORES } from "../src/domain/automacoes/catalogo";
import { destinoDaAutomacao, textoDaAutomacao } from "../src/domain/automacoes/destino";
import {
  FORM_VAZIO,
  lerAutomacao,
  mesmoAlvo,
  resumoDaAutomacao,
  validarAutomacao,
  type FormAutomacao,
} from "../src/domain/automacoes/formulario";
import { variaveisUsadas } from "../src/domain/automacoes/mensagem";
import { lerPainelDePrecos } from "../src/domain/catalogo/painel-de-precos";

/**
 * Pedido do dono em 10/10/2026:
 *   "avise o Gestor (gerente) pra corrigir, avise e dispare no whatsapp dele
 *    também os lembretes" — orçamentos aprovados que nunca viraram OS;
 *   margem de 85% no catálogo "e mostra pro Admin e Gerente também um painel".
 *
 * O lembrete é uma automação comum (gatilho orcamento_aprovado_sem_os), com a
 * varredura do banco às 9h de segunda a sábado. O painel é a função
 * catalogo_painel_de_precos, só para quem gerencia o catálogo E vê o custo.
 */

const SQL = readFileSync(
  "supabase/migrations/20261010120000_lembrete_gestao_e_painel_do_catalogo.sql",
  "utf8",
);

/** A mensagem que a migração grava na automação, montada como o banco monta. */
function mensagemDaMigracao(): string {
  const trecho = SQL.slice(SQL.indexOf("'mensagem',"), SQL.indexOf("43200"));
  return [...trecho.matchAll(/E'((?:[^']|'')*)'/g)]
    .map((m) => m[1].replace(/''/g, "'").replace(/\\n/g, "\n"))
    .join("");
}

const CONTEXTO = {
  gestor: { nome: "Yvens", telefone_normalizado: "96991564805" },
  quantidade: 8,
  valor_total: "R$ 2.299,91",
  lista: "#55 · Max Lima · banner · R$ 38,40 · aprovado há 12 dias",
  link: "https://bexprint.com.br/orcamentos",
  dia: "2026-10-10",
};

describe("o gatilho do lembrete à gerência", () => {
  const info = CATALOGO.orcamento_aprovado_sem_os;

  it("nunca vai ao cliente e oferece o destino 'os gestores'", () => {
    expect(info.aceitaCliente).toBe(false);
    expect(info.paraGestores).toBe(true);
    expect(TELEFONE_DOS_GESTORES).toBe("55{{gestor.telefone_normalizado}}");
  });

  it("toda variável da mensagem gravada pela migração existe no catálogo da tela", () => {
    const mensagem = mensagemDaMigracao();
    expect(mensagem).toContain("Converter em OS");
    const declaradas = info.variaveis.map((v) => v.chave);
    expect(variaveisUsadas(mensagem).filter((v) => !declaradas.includes(v))).toEqual([]);
  });

  it("a mensagem sai inteira, sem variável em branco, e o destino é o telefone do gestor com 55", () => {
    const execucao = {
      gatilho: "orcamento_aprovado_sem_os",
      contexto: CONTEXTO,
      payload: {},
      automacao: { payload: { telefone: TELEFONE_DOS_GESTORES, mensagem: mensagemDaMigracao() } },
      telefonePadrao: null,
    };
    const texto = textoDaAutomacao(execucao);
    expect(texto).toContain("Olá, Yvens!");
    expect(texto).toContain("8, somando R$ 2.299,91");
    expect(texto).not.toMatch(/{{|}}/);
    expect(destinoDaAutomacao(execucao)).toEqual({ ok: true, telefone: "5596991564805" });
  });

  it("gestor sem telefone no contexto não cai no cliente nem no número errado", () => {
    const d = destinoDaAutomacao({
      gatilho: "orcamento_aprovado_sem_os",
      contexto: { ...CONTEXTO, gestor: { nome: "Yvens" } },
      payload: {},
      automacao: { payload: { telefone: TELEFONE_DOS_GESTORES, mensagem: "oi" } },
      telefonePadrao: null,
    });
    // "55" sozinho não é número: o Z-API recusa, e a execução vira erro com motivo.
    expect(d.ok === false || d.telefone === "55").toBe(true);
  });
});

describe("o destino 'os gestores' no formulário", () => {
  const base: FormAutomacao = {
    ...FORM_VAZIO,
    nome: "Lembrete à gerência",
    gatilho: "orcamento_aprovado_sem_os",
    destino: "gestores",
    mensagem: "Olá, {{gestor.nome}}! {{quantidade}} orçamentos: {{lista}}",
    intervaloSegundos: 43200,
  };

  it("grava o telefone do cadastro de cada gestor", () => {
    const r = validarAutomacao(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registro.payload.telefone).toBe(TELEFONE_DOS_GESTORES);
  });

  it("gatilho que não sabe quem é o gestor recusa esse destino", () => {
    const r = validarAutomacao({ ...base, gatilho: "os_atrasada", mensagem: "A OS {{os.numero}} atrasou." });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.destino).toBeTruthy();
  });

  it("ida e volta: a linha do banco volta como 'gestores' e o cartão diz para quem vai", () => {
    const linha = {
      id: "x",
      nome: "Lembrete à gerência: orçamentos aprovados sem OS",
      descricao: null,
      gatilho: "orcamento_aprovado_sem_os",
      condicao: {},
      acao: "whatsapp",
      payload: { telefone: TELEFONE_DOS_GESTORES, mensagem: mensagemDaMigracao() },
      ativo: true,
      cooldown_segundos: 43200,
      delay_segundos: 0,
    };
    expect(lerAutomacao(linha).destino).toBe("gestores");
    const resumo = resumoDaAutomacao(linha);
    expect(resumo.destino).toBe("os gestores, no telefone do cadastro de cada um");
    expect(resumo.executavel).toBe(true);
    expect(resumo.intervalo).toBe("no máximo 1 aviso por gestor a cada 12 horas");
  });

  it("o texto de 'o mesmo' concorda com o alvo", () => {
    expect(mesmoAlvo("gestor")).toBe("o mesmo gestor");
    expect(mesmoAlvo("material")).toBe("o mesmo material");
    expect(mesmoAlvo("OS")).toBe("a mesma OS");
  });
});

describe("a migração", () => {
  it("o lembrete só roda pelo servidor e pelo job das 9h, de segunda a sábado", () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.lembrete_orcamentos_aprovados_sem_os\(\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(SQL).toMatch(/'lembrete-gestao-orcamentos',\s*'0 12 \* \* 1-6'/);
    // Silêncio quando não há nada.
    expect(SQL).toMatch(/IF coalesce\(v_qtd, 0\) = 0 THEN\s*RETURN/);
  });

  it("o gatilho novo entra na condição e na lista de situações do motor", () => {
    expect(SQL).toMatch(/'pagamento_atrasado','os_atrasada','orcamento_aprovado_sem_os'\) THEN/);
    expect(SQL).toMatch(/'margem_abaixo_minimo','orcamento_aprovado_sem_os'\)/);
  });

  it("o painel de preço exige gerenciar o catálogo E ver o financeiro, e fecha o anon", () => {
    expect(SQL).toMatch(/require_permission\('catalogo\.manage'\)/);
    expect(SQL).toMatch(/IF NOT public\.can_see_financials\(v_uid\) THEN/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.catalogo_painel_de_precos\(\) FROM PUBLIC, anon;/);
  });
});

describe("o painel de preço, lido com desconfiança", () => {
  // Retrato do banco em 10/10/2026, depois da margem de 85%.
  const bruto = {
    catalogos: [
      {
        catalogo_id: "a8e0fa60-03d1-4f77-8efd-1330ddebf9c3",
        titulo: "LUGA 2027",
        regra: {
          margem_pct: "85.00",
          frete_por_peca: null,
          arredondamento: "0.00",
          atualizado_em: "2026-10-10T19:45:11.351092+00:00",
          atualizado_por: "Harison",
        },
        excecoes: 0,
        totais: { itens: 921, opcoes: 1796, itens_com_preco: 910, opcoes_com_preco: 1785, opcoes_sob_consulta: 11 },
        categorias: [
          {
            categoria: "cadernos",
            itens: 180,
            itens_com_preco: 180,
            menor_preco: 1.84,
            maior_preco: 36.95,
            exemplo: { nome: "Caderneta Tipo Moleskine", codigo_bex: "BX-0197", custo: "6.1100", frete: 0, preco: 11.31, unidade: "unidade" },
          },
          { categoria: "outros", itens: 3, itens_com_preco: 0, menor_preco: null, maior_preco: null, exemplo: null },
        ],
      },
    ],
  };

  it("número que vem como texto vira número, e o ganho por peça sai da conta", () => {
    const [c] = lerPainelDePrecos(bruto);
    expect(c.regra?.margem_pct).toBe(85);
    expect(c.totais.itens_com_preco).toBe(910);
    expect(c.categorias[0].exemplo).toMatchObject({ custo: 6.11, preco: 11.31, ganho: 5.2 });
  });

  it("o que falta fica null, nunca zero", () => {
    const [c] = lerPainelDePrecos(bruto);
    expect(c.regra?.frete_por_peca).toBeNull();
    expect(c.categorias[1].menor_preco).toBeNull();
    expect(c.categorias[1].exemplo).toBeNull();
  });

  it("resposta estranha não derruba a tela", () => {
    expect(lerPainelDePrecos(null)).toEqual([]);
    expect(lerPainelDePrecos({ catalogos: "x" })).toEqual([]);
  });
});
