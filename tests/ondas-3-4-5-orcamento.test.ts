import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const le = (p: string) => readFileSync(p, "utf8");
const pagina = le("src/routes/_authenticated/orcamentos.$id.tsx");
const lista = le("src/routes/_authenticated/orcamentos.index.tsx");
const sql = le("supabase/migrations/20261026960000_painel_funil_orcamentos.sql");
const texto = le("src/lib/api/whatsapp-texto.functions.ts");

describe("Onda 3: itens mais rápidos", () => {
  it("repete o último pedido do cliente e marca o acabamento padrão do produto", () => {
    expect(pagina).toContain("repetirUltimoPedido");
    expect(pagina).toContain("a.padrao");
  });
});

describe("Onda 4: envio pelo sistema em todos os pontos de contato", () => {
  it("o texto avulso confere whatsapp.reply e usa a fila da caixa", () => {
    expect(texto).toContain('"whatsapp.reply"');
    expect(texto).toContain("whatsapp_fila_envio");
  });
  it("Pix, portal e aprovação de arte oferecem o botão", () => {
    for (const f of [
      "src/components/pagamento/pix-do-orcamento.tsx",
      "src/components/cliente/acesso-portal-card.tsx",
      "src/components/arquivos/enviar-para-aprovacao.tsx",
    ]) {
      expect(le(f)).toContain("BotaoEnviarPeloSistema");
    }
  });
  it("o lembrete só aparece depois de 48 h e é um clique de quem autoriza", () => {
    expect(pagina).toContain("48 * 3600_000");
    expect(pagina).toContain("lembrarCliente");
  });
});

describe("Onda 5: medir o funil", () => {
  it("a função do banco confere permissão e não devolve valores em dinheiro", () => {
    expect(sql).toContain("orcamentos.convert");
    expect(sql).not.toMatch(/'valor/);
  });
  it("o painel aparece só para quem converte", () => {
    expect(lista).toContain("{podeConverter && <FunilDoOrcamento />}");
  });
});

describe("Conversão: o clique não vira 'aprovar antes'", () => {
  it("nenhum botão passa o evento do clique para converterEmOS", () => {
    expect(pagina).not.toContain("onClick={converterEmOS}");
  });
});
