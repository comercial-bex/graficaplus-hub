import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS } from "../src/domain/os/etapas";
import {
  formatarReal,
  formatarTamanho,
  resumoDoPortal,
  rotuloDoArquivo,
  separarOrdens,
  situacaoParaOCliente,
  tipoDePrevia,
  valorDoPedido,
  type OrdemNoPortal,
  type OrcamentoNoPortal,
} from "../src/domain/portal/painel-do-cliente";

/**
 * O que o cliente vê, nas duas portas do portal.
 *
 * Duas coisas aqui não podem escorregar:
 *   1. todo status da OS tem frase na língua do cliente — status novo no enum
 *      sem frase apareceria cru ("aguardando_producao") na tela dele;
 *   2. o painel que o banco monta é lista FECHADA e sem dinheiro interno — a
 *      tela antiga mostrava a receita líquida da OS ao cliente.
 */

const RAIZ = resolve(__dirname, "..");
const MIGRACAO = join(RAIZ, "supabase/migrations/20261002101001_portal_do_cliente.sql");

function ordem(parcial: Partial<OrdemNoPortal>): OrdemNoPortal {
  return {
    id: crypto.randomUUID(),
    numero: 44,
    titulo: "Banner",
    status: "entrada",
    prazo_entrega: null,
    entregue_em: null,
    criado_em: "2026-10-01T12:00:00Z",
    precisa_entrega: false,
    precisa_instalacao: false,
    valor_pedido: 100,
    artes_para_aprovar: [],
    arquivos: [],
    documentos: [],
    ...parcial,
  };
}

describe("a situação da OS na língua do cliente", () => {
  it("todo status do enum tem frase, sem jargão de oficina", () => {
    for (const { status } of STATUS) {
      const s = situacaoParaOCliente(status);
      expect(s.detalhe, status).not.toBe("");
      expect(s.titulo, status).not.toBe("");
      // Nada de nome de coluna, de setor interno nem de faturamento.
      expect(`${s.titulo} ${s.detalhe}`, status).not.toMatch(/_|PCP|fatura/i);
    }
  });

  it("entregue é entregue — faturado é assunto da gráfica, não do cliente", () => {
    expect(situacaoParaOCliente("concluido").titulo).toBe("Entregue");
    expect(situacaoParaOCliente("faturado").titulo).toBe("Entregue");
    expect(situacaoParaOCliente("faturado").progresso).toBe(1);
  });

  it("cancelada e pausada ficam fora da barra de andamento", () => {
    expect(situacaoParaOCliente("cancelado")).toMatchObject({
      titulo: "Cancelado",
      progresso: null,
    });
    expect(situacaoParaOCliente("pausado")).toMatchObject({ titulo: "Pausado", progresso: null });
  });

  it("a etapa (as cinco do quadro) é o título enquanto anda", () => {
    expect(situacaoParaOCliente("em_corte").titulo).toBe("Produção");
    expect(situacaoParaOCliente("em_corte").detalhe).toContain("recorte");
    expect(situacaoParaOCliente("design").titulo).toBe("Pré-impressão");
    expect(situacaoParaOCliente("controle_qualidade").titulo).toBe("Acabamento e qualidade");
  });

  it("diz quando falta o cliente", () => {
    expect(situacaoParaOCliente("aguardando_aprovacao_arte").esperaPeloCliente).toBe(true);
    expect(situacaoParaOCliente("aguardando_retirada").esperaPeloCliente).toBe(true);
    expect(situacaoParaOCliente("em_impressao").esperaPeloCliente).toBe(false);
  });

  it("status desconhecido não quebra a tela", () => {
    expect(situacaoParaOCliente("talvez").titulo).toBe("talvez");
    expect(situacaoParaOCliente(null).detalhe).toBe("");
  });
});

describe("as contas da tela", () => {
  const ordens = [
    ordem({ status: "em_impressao", valor_pedido: 120 }),
    ordem({
      status: "aguardando_aprovacao_arte",
      valor_pedido: 80,
      artes_para_aprovar: [
        { arquivo_id: "a", nome: "arte.png", mime: "image/png", pedida_em: "x", vence_em: "y" },
      ],
    }),
    ordem({ status: "aguardando_retirada", valor_pedido: 50 }),
    ordem({ status: "concluido", valor_pedido: 999 }),
    ordem({ status: "cancelado", valor_pedido: 777 }),
  ];
  const orcamentos: OrcamentoNoPortal[] = [
    {
      id: "o1",
      numero: 61,
      titulo: "Placas",
      status: "enviado",
      valor_total: 1050,
      criado_em: "",
      enviado_em: null,
      validade_dias: 7,
      token_publico: "t",
    },
    {
      id: "o2",
      numero: 55,
      titulo: "Adesivo",
      status: "aprovado",
      valor_total: 38.4,
      criado_em: "",
      enviado_em: null,
      validade_dias: 7,
      token_publico: null,
    },
  ];

  it("em andamento não conta entregue nem cancelada, e o valor também não", () => {
    const r = resumoDoPortal({ ordens, orcamentos });
    expect(r.emAndamento).toBe(3);
    expect(r.entregues).toBe(1);
    expect(r.valorEmAndamento).toBe(250);
  });

  it("esperando você = arte para aprovar + orçamento enviado + pronto para retirar", () => {
    expect(resumoDoPortal({ ordens, orcamentos }).esperandoVoce).toBe(3);
  });

  it("separa abertas de encerradas pelas palavras do enum", () => {
    const { abertas, encerradas } = separarOrdens(ordens);
    expect(abertas).toHaveLength(3);
    expect(encerradas.map((o) => o.status).sort()).toEqual(["cancelado", "concluido"]);
  });

  it("pedido ainda sem preço não aparece como R$ 0,00", () => {
    expect(valorDoPedido(0)).toBe("a definir");
    expect(valorDoPedido(null)).toBe("a definir");
    expect(valorDoPedido(121.15)).toMatch(/R\$\s?121,15/);
  });

  it("dinheiro e tamanho em português", () => {
    expect(formatarReal(121.15)).toMatch(/R\$\s?121,15/);
    expect(formatarReal(null)).toBe("—");
    expect(formatarTamanho(2048)).toBe("2 KB");
    expect(formatarTamanho(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatarTamanho(0)).toBe("");
  });

  it("o arquivo que o cliente mandou é dito como dele", () => {
    expect(rotuloDoArquivo({ tipo: "arte", do_cliente: true })).toBe("Arte que você mandou");
    expect(rotuloDoArquivo({ tipo: "producao", do_cliente: false })).toBe("Arquivo");
  });

  it("prévia: imagem na tela, PDF em nova aba", () => {
    expect(tipoDePrevia("image/png", "x")).toBe("imagem");
    expect(tipoDePrevia(null, "ARTE.JPG")).toBe("imagem");
    expect(tipoDePrevia("application/pdf", "x")).toBe("pdf");
    expect(tipoDePrevia(null, "arte.cdr")).toBe("outro");
  });
});

/** Corpo de uma função da migração (entre as aspas de dólar). */
function corpoDaFuncao(sql: string, nome: string): string {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${nome}\\([\\s\\S]*?AS \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
  ).exec(sql);
  if (!m) throw new Error(`função ${nome} não está na migração`);
  return m[2];
}

describe("o painel que o banco monta é lista fechada", () => {
  const sql = readFileSync(MIGRACAO, "utf8");
  const corpo = corpoDaFuncao(sql, "portal_painel_do_cliente")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  // Tira os `IN ('enviado', 'aprovado')` dos filtros: são valores, não chaves.
  const chaves = [...corpo.replace(/IN \([^)]*\)/g, "").matchAll(/'([a-z_]+)',\s/g)].map(
    (m) => m[1],
  );

  it("só estas chaves saem para o cliente", () => {
    const PERMITIDAS = new Set([
      // cliente e empresa
      "id",
      "nome",
      "telefones",
      "email",
      // OS
      "numero",
      "titulo",
      "status",
      "prazo_entrega",
      "entregue_em",
      "criado_em",
      "precisa_entrega",
      "precisa_instalacao",
      "valor_pedido",
      "artes_para_aprovar",
      "arquivos",
      "documentos",
      "arquivo_id",
      "mime",
      "pedida_em",
      "vence_em",
      "tipo",
      "situacao",
      "tamanho_bytes",
      "do_cliente",
      // orçamentos (o preço, não o custo) e o que o cliente mandou
      "valor_total",
      "enviado_em",
      "validade_dias",
      "token_publico",
      "mensagem",
      "os_numero",
      "motivo",
      // envelope
      "versao",
      "gerado_em",
      "cliente",
      "empresa",
      "ordens",
      "orcamentos",
      "solicitacoes",
      "comprovantes",
    ]);
    expect(chaves.length).toBeGreaterThan(30);
    expect(chaves.filter((c) => !PERMITIDAS.has(c))).toEqual([]);
  });

  it("nenhuma chave de dinheiro interno", () => {
    expect(chaves.filter((c) => /custo|margem|lucro|receita|resultado|desconto/.test(c))).toEqual(
      [],
    );
    // valor do pedido vem do total, nunca de custo_* nem margem_*
    expect(corpo).toMatch(/'valor_pedido', coalesce\(f\.valor_total, o\.valor_total\)/);
    expect(corpo).not.toMatch(/custo_|margem_|lucro_|receita_liquida/);
  });

  it("arquivo de produção não aparece: só arte, o que foi para aprovação e o que o cliente mandou", () => {
    const regra = corpoDaFuncao(sql, "portal_arquivo_visivel");
    expect(regra).toMatch(/a\.caminho LIKE 'portal\/' \|\| p_cliente_id::text \|\| '\/%'/);
    expect(regra).toMatch(/a\.tipo::text = 'arte'/);
    expect(regra).toMatch(/arquivo_tokens_externos t WHERE t\.arquivo_id = a\.id/);
    expect(regra).toMatch(/a\.status::text NOT IN \('inativo', 'substituido'\)/);
    expect(regra).not.toMatch(/producao/);
  });
});
