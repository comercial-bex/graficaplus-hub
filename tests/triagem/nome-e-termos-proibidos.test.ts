import { describe, expect, it } from "vitest";
import { extrairNome, verificarTexto } from "../../src/domain/whatsapp/triagem";
import { MIGRACAO_B1, lerMigracao, lerTuplas, semComentarios } from "./sql-lido-como-texto";

/**
 * Um nome que o contato digita volta na mensagem do robô ("Prazer, {{primeiro_nome}}!"), e o banco barra o texto
 * montado se ele tiver termo proibido. Se o TypeScript aceitar como nome uma palavra que o banco proíbe, uma única
 * resposta ("Pix") faz o texto ser barrado. Estes testes seguram que `extrairNome` recusa tudo que o banco proíbe,
 * lendo a lista direto da migração, para as duas listas nunca divergirem.
 */
const B1 = semComentarios(lerMigracao(MIGRACAO_B1));
type Termo = { regra: string; termo: string; tipo: string; sobre: string; ramo: string };
const TERMOS: Termo[] = lerTuplas(B1, "whatsapp_triagem_termos_proibidos").map((t) => ({
  regra: String(t[0]),
  termo: String(t[1]),
  tipo: String(t[2]),
  sobre: String(t[3]),
  ramo: String(t[4]),
}));

/** Uma palavra de exemplo para cada regra do banco que é feita de palavra (as outras são símbolo ou número). */
const PALAVRA_DA_REGRA: Record<string, string[]> = {
  valor_em_reais: ["Reais"],
  porcentagem: ["Porcentagem"],
  desconto: ["Desconto"],
  pix: ["Pix", "PIX"],
  boleto: ["Boleto"],
  parcelamento: ["Parcela", "Parcelamento"],
  juros: ["Juros"],
  nota_fiscal: ["Nota Fiscal", "Notafiscal"],
  parceiro: ["Parceiro"],
  parceria: ["Parceria"],
  terceirizado: ["Terceirizado"],
  revenda: ["Revendedor"],
  tabela: ["Tabela"],
  preco_diferenciado: ["Diferenciado"],
  preco_especial: ["Atacado"],
};
/** Regras que só existem com símbolo ou dígito: um nome só de letras nunca as aciona. */
const REGRA_SEM_PALAVRA = [
  "moeda",
  "valor_com_centavos",
  "valor_depois_de_valor",
  "prazo_em_numero",
  "travessao",
  "seta",
  "parenteses",
  "palavrao",
  "pedido_ou_produto",
];

describe("nome x termos proibidos do banco", () => {
  it("toda regra do banco tem palavra de exemplo ou está na lista das que dependem de símbolo ou dígito", () => {
    const regras = new Set(TERMOS.map((t) => t.regra));
    for (const r of regras) {
      expect(r in PALAVRA_DA_REGRA || REGRA_SEM_PALAVRA.includes(r), `regra nova sem cobertura: ${r}`).toBe(true);
    }
  });

  it.each(Object.entries(PALAVRA_DA_REGRA).flatMap(([regra, palavras]) => palavras.map((p) => [regra, p])))(
    "regra %s: %j não é nome",
    (_regra, palavra) => {
      expect(extrairNome(palavra).ok).toBe(false);
    },
  );

  it("as palavras que o banco chama de 'nome' (palavrão, pedido, produto) também são recusadas", () => {
    const listas = TERMOS.filter((t) => ["palavrao", "pedido_ou_produto"].includes(t.regra));
    expect(listas.length).toBe(2);
    let n = 0;
    for (const l of listas) {
      const grupo = /\\y\(([^)]+)\)\\y/.exec(l.termo);
      expect(grupo, l.regra).not.toBeNull();
      for (const palavra of grupo![1].split("|")) {
        const lida = extrairNome(palavra);
        expect(lida.ok, `${l.regra}: ${palavra}`).toBe(false);
        n++;
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it("os casos da revisão: nenhum vira 'Prazer, X!' barrado", () => {
    for (const p of ["Pix", "Juros", "Boleto", "Parcela", "Reais", "Diferenciado", "Notafiscal", "Porcentagem"]) {
      expect(extrairNome(p), p).toMatchObject({ ok: false, motivo: "palavra_barrada" });
      expect(extrairNome(`meu nome é ${p}`).ok, `meu nome é ${p}`).toBe(false);
      expect(extrairNome(`Maria ${p}`).ok, `Maria ${p}`).toBe(false);
    }
  });

  it("todo nome aceito monta um texto que o verificador deixa passar", () => {
    for (const entrada of [
      "Maria Souza",
      "João da Silva Pereira",
      "Ana-Clara",
      "D'Ávila Costa",
      "Maria de Lourdes Santos Lima",
      "Maria Aparecida dos Santos Silva",
      "Real Madrid",
    ]) {
      const r = extrairNome(entrada);
      if (!r.ok) continue;
      const texto = `Prazer, ${r.primeiroNome}! Você já é cliente da Bex Print? ${r.nome}`;
      expect(verificarTexto(texto, "cliente").ok, entrada).toBe(true);
    }
  });
});
