import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A faixa "Relacionados" nas fichas do cliente, do orçamento e da OS (23/11/2026, Onda 1 do diagnóstico).
 * Estas conferências leem o código-fonte: provam a ligação e as regras que não podem se perder (só leitura, financeiro só
 * para quem vê finanças, mesma conta da tela "A receber", trava de "Baixar estoque" igual à do banco).
 */

const ler = (caminho: string) => readFileSync(caminho, "utf8");
const OS = ler("src/routes/_authenticated/os.$id.tsx");
const ORCAMENTO = ler("src/routes/_authenticated/orcamentos.$id.tsx");
const CLIENTE = ler("src/routes/_authenticated/clientes.$id.tsx");
const A_RECEBER = ler("src/routes/_authenticated/a-receber.tsx");
const HOOKS = ler("src/components/relacionados/usar-relacionados.ts");
const FICHAS = ler("src/components/relacionados/relacionados-das-fichas.tsx");
const FAIXA = ler("src/components/relacionados/relacionados-do-registro.tsx");
const LEITURA = ler("src/lib/contas-a-receber-leitura.ts");
const DOMINIO = ler("src/domain/relacionados/elos.ts");

const SEM_COMENTARIOS = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("as três fichas desenham a faixa com o registro que já carregaram", () => {
  it("a ficha da OS", () => {
    expect(OS).toContain('import { RelacionadosDaOs } from "@/components/relacionados/relacionados-das-fichas"');
    expect(OS).toMatch(/<RelacionadosDaOs osId=\{id\} os=\{os\} \/>/);
  });
  it("a ficha do orçamento, logo depois do cabeçalho", () => {
    expect(ORCAMENTO).toContain('import { RelacionadosDoOrcamento } from "@/components/relacionados/relacionados-das-fichas"');
    expect(ORCAMENTO).toMatch(/<\/header>\s*\{\/\*[^*]*\*\/\}\s*<RelacionadosDoOrcamento orcamentoId=\{id\} orc=\{orc\} \/>/);
  });
  it("a ficha do cliente, depois dos números e antes das abas", () => {
    expect(CLIENTE).toContain('import { RelacionadosDoCliente } from "@/components/relacionados/relacionados-das-fichas"');
    const iStats = CLIENTE.indexOf("<StatsCard");
    const iFaixa = CLIENTE.indexOf("<RelacionadosDoCliente clienteId={id} />");
    const iAbas = CLIENTE.indexOf('<Tabs defaultValue="resumo">');
    expect(iStats).toBeGreaterThan(-1);
    expect(iFaixa).toBeGreaterThan(iStats);
    expect(iAbas).toBeGreaterThan(iFaixa);
  });
});

describe("a faixa só lê", () => {
  const codigo = SEM_COMENTARIOS(HOOKS) + SEM_COMENTARIOS(LEITURA) + SEM_COMENTARIOS(FICHAS) + SEM_COMENTARIOS(FAIXA);
  it("nenhuma escrita no banco", () => {
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("a única função chamada é a mesma de leitura da tela A receber", () => {
    const rpcs = [...codigo.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["contas_a_receber"]);
    expect(A_RECEBER).toMatch(/rpc\(\s*"contas_a_receber"/);
  });
  it("sem `as any` e sem atributo title do navegador nos arquivos novos", () => {
    for (const fonte of [HOOKS, LEITURA, FICHAS, FAIXA, DOMINIO]) {
      expect(SEM_COMENTARIOS(fonte)).not.toMatch(/\bas any\b/);
    }
    expect(SEM_COMENTARIOS(FAIXA)).not.toMatch(/\stitle=/);
  });
});

describe("o dinheiro só aparece para quem vê finanças e é a mesma conta da tela A receber", () => {
  it("as contas só são lidas com canSeeFinancials", () => {
    expect(FICHAS).toMatch(/useContasDaOsLidas\(osId, canSeeFinancials\)/);
    expect(FICHAS).toMatch(/useContasDoClienteLidas\(clienteId, canSeeFinancials\)/);
  });
  it("a consulta fica desligada sem acesso e o estado é 'sem acesso', nunca 'vazio'", () => {
    expect(HOOKS).toMatch(/enabled: temAcesso/);
    expect(DOMINIO).toMatch(/if \(!temAcesso\) return \{ estado: "sem_acesso" \}/);
  });
  it("os envios do orçamento só são lidos com orcamentos.read (a política do banco devolveria vazio e vazio diria 'nunca enviado')", () => {
    expect(FICHAS).toMatch(/useEnviosDoOrcamento\(orcamentoId, hasPermission\("orcamentos\.read"\)\)/);
    expect(HOOKS).toMatch(/export function useEnviosDoOrcamento\(orcamentoId: string, temAcesso: boolean\)/);
  });
  it("o cache usa o prefixo que a tela A receber invalida ao dar baixa numa parcela", () => {
    expect(HOOKS).toMatch(/queryKey: \["contas-a-receber", "relacionados"\]/);
    expect(A_RECEBER).toMatch(/invalidateQueries\(\{ queryKey: \["contas-a-receber"\] \}\)/);
  });
  it("os valores vêm do banco: a faixa não recalcula vencido nem a receber a partir das parcelas", () => {
    const resumo = DOMINIO.slice(DOMINIO.indexOf("export function resumirContas"), DOMINIO.indexOf("/** Filtra as contas"));
    expect(resumo).toMatch(/centavos\(c\.a_receber\)/);
    expect(resumo).toMatch(/centavos\(c\.vencido\)/);
    expect(resumo).not.toMatch(/centavos\(p\.valor\)/);
  });
});

describe("o link só aparece onde a pessoa abre a tela (a regra do menu)", () => {
  it("usa getRoutePermissions, como o menu e o painel", () => {
    expect(FICHAS).toMatch(/getRoutePermissions\(caminho\)/);
    expect(FICHAS).toMatch(/aplicarAcesso\(/);
  });
});

describe("o produto da OS vem dos itens", () => {
  it("lê itens_os.produto_id, não o produto_id da própria OS (vazio nas 54 OS em 23/11/2026)", () => {
    expect(HOOKS).toMatch(/fromFinancialView\("itens_os", nivel\)/);
    // sem os comentários: o texto que EXPLICA o porquê cita o campo, o código não o lê
    expect(SEM_COMENTARIOS(HOOKS)).not.toMatch(/ordens_servico[^\n]*produto_id/);
  });
});

describe("Baixar estoque some para quem o banco recusaria", () => {
  it("a permissão é a que baixar_estoque_os exige no banco (estoque.exit)", () => {
    const migracao = ler("supabase/migrations/20260825140000_baixa_de_estoque_honesta.sql");
    expect(migracao).toMatch(/baixar_estoque_os/);
    expect(migracao).toMatch(/estoque\.exit/);
    expect(OS).toMatch(/const podeBaixarEstoque = hasPermission\("estoque\.exit"\);/);
  });
  it("vale para o botão do computador e para o item do menu do celular", () => {
    const usos = OS.match(/\{podeBaixarEstoque && \(/g) ?? [];
    expect(usos).toHaveLength(2);
    // nenhuma outra porta abre o diálogo de baixa
    const aberturas = OS.match(/setBaixaOpen\(true\)/g) ?? [];
    expect(aberturas).toHaveLength(2);
  });
});
