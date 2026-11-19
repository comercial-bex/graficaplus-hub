import { describe, expect, it } from "vitest";
import {
  agruparPorResponsavel,
  desdeSemContato,
  fechadoSemContato,
  montarLembreteCredito,
  montarLembreteEquipe,
  situacaoDoContato,
  type LinhaSemContato,
} from "@/domain/parceiros/sem-contato";

const h = (n: number) => new Date(Date.UTC(2026, 10, 16, 12) + n * 3_600_000);

describe("regra de sem contato", () => {
  it("sem mensagem da equipe desde que o chamado abriu conta desde a abertura", () => {
    expect(
      desdeSemContato({ abertoEm: h(0), ultimaSaidaEquipe: null, ultimaEntrada: null }),
    ).toEqual(h(0));
    // resposta antiga, de antes do chamado, não vale
    expect(
      desdeSemContato({ abertoEm: h(0), ultimaSaidaEquipe: h(-5), ultimaEntrada: h(1) }),
    ).toEqual(h(0));
  });
  it("parceiro escreveu depois da última resposta conta desde a mensagem dele", () => {
    expect(
      desdeSemContato({ abertoEm: h(0), ultimaSaidaEquipe: h(2), ultimaEntrada: h(3) }),
    ).toEqual(h(3));
  });
  it("equipe respondeu por último: em dia", () => {
    expect(
      desdeSemContato({ abertoEm: h(0), ultimaSaidaEquipe: h(3), ultimaEntrada: h(2) }),
    ).toBeNull();
  });
  it("só passa a ser sem contato acima de 48 horas", () => {
    const c = { abertoEm: h(0), ultimaSaidaEquipe: null, ultimaEntrada: null };
    expect(situacaoDoContato(c, h(48), 48).semContato).toBe(false);
    expect(situacaoDoContato(c, h(49), 48)).toEqual({ semContato: true, horas: 49 });
  });
});

const linha = (
  nome: string,
  resp: string | null,
  horas: number,
  extra: Partial<LinhaSemContato> = {},
) =>
  ({
    parceiro_id: nome,
    nome,
    responsavel_id: resp,
    responsavel_nome: resp,
    horas_sem_contato: horas,
    credito: 0,
    credito_vence_em: null,
    ...extra,
  }) as LinhaSemContato;

describe("lembrete à equipe", () => {
  it("agrupa por responsável, quem espera mais primeiro", () => {
    const g = agruparPorResponsavel([
      linha("A", "Maiara", 50),
      linha("B", "Jess", 60),
      linha("C", "Maiara", 70),
    ]);
    expect(g.map((x) => [x.responsavel_nome, x.linhas.map((l) => l.nome)])).toEqual([
      ["Jess", ["B"]],
      ["Maiara", ["C", "A"]],
    ]);
  });
  it("monta a mensagem citando responsável e gestor, com crédito e link", () => {
    const txt = montarLembreteEquipe(
      [
        linha("Aline", "Maiara", 52, {
          responsavel_tel: "96991112222",
          credito: 50,
          credito_vence_em: "2026-12-14T16:25:37Z",
        }),
      ],
      { horas: 48, telefonesGestor: ["96988887777"] },
    );
    expect(txt).toBe(
      "Bom dia! 1 parceiro sem contato da equipe há mais de 48 horas:\n\n" +
        "Maiara @5596991112222\n- Aline · 52h · crédito R$ 50,00 até 14/12\n\n" +
        "Gestor @5596988887777 acompanhe.\nVer a lista: https://bexprint.com.br/parceiros",
    );
  });
  it("corta em 15 linhas de parceiro e diz quantos ficaram de fora", () => {
    const muitos = Array.from({ length: 18 }, (_, i) =>
      linha(`P${String(i).padStart(2, "0")}`, "Maiara", 100 - i),
    );
    const txt = montarLembreteEquipe(muitos, { horas: 48, telefonesGestor: [] });
    expect(txt.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(15);
    expect(txt).toContain("\nE mais 3.\n");
    expect(txt).toContain("18 parceiros");
  });
});

describe("lembrete do crédito", () => {
  it("preenche primeiro nome, saldo, data e mínimo", () => {
    expect(
      montarLembreteCredito({
        nome: "Aline Souza",
        credito: 50,
        venceEm: new Date("2026-12-14T16:25:37Z"),
        minimo: 150,
      }),
    ).toBe(
      "Oi, Aline! Seu crédito de R$ 50,00 na Bex Print vence em 14/12. Ele vale na sua 1ª compra a partir de R$ 150,00 em produtos. Tem algum serviço na mão? É só responder aqui.\n\nPara não receber estes avisos, responda SAIR.",
    );
  });
});

describe("chamado fechado sem nenhuma mensagem", () => {
  it("fechado sem mensagem da equipe continua sem contato, desde a abertura, mesmo antes de N horas", () => {
    const c = { abertoEm: h(0), ultimaSaidaEquipe: null, ultimaEntrada: h(1), fechadoEm: h(2) };
    expect(fechadoSemContato(c)).toBe(true);
    expect(desdeSemContato(c)).toEqual(h(0));
    expect(situacaoDoContato(c, h(3), 48)).toEqual({ semContato: true, horas: 3 });
  });
  it("resposta antiga, de antes do chamado abrir, não conta como contato", () => {
    expect(
      fechadoSemContato({ abertoEm: h(0), ultimaSaidaEquipe: h(-10), ultimaEntrada: null, fechadoEm: h(1) }),
    ).toBe(true);
  });
  it("mensagem da equipe depois do fechamento também conta como contato", () => {
    const c = { abertoEm: h(0), ultimaSaidaEquipe: h(5), ultimaEntrada: h(1), fechadoEm: h(2) };
    expect(fechadoSemContato(c)).toBe(false);
    expect(situacaoDoContato(c, h(100), 48).semContato).toBe(false);
  });
  it("fechado depois de falar com a equipe segue a regra de antes", () => {
    const c = { abertoEm: h(0), ultimaSaidaEquipe: h(1), ultimaEntrada: h(3), fechadoEm: h(2) };
    expect(fechadoSemContato(c)).toBe(false);
    expect(situacaoDoContato(c, h(40), 48).semContato).toBe(false);
    expect(situacaoDoContato(c, h(52), 48)).toEqual({ semContato: true, horas: 49 });
  });
  it("chamado aberto nunca é 'fechado sem mensagem'", () => {
    expect(fechadoSemContato({ abertoEm: h(0), ultimaSaidaEquipe: null, ultimaEntrada: null })).toBe(false);
  });

  const base = { responsavel_id: "r1", responsavel_nome: "Raymison", credito: 0, credito_vence_em: null };
  it("lembrete traz bloco separado com quem fechou e o dia", () => {
    const texto = montarLembreteEquipe(
      [
        { ...base, parceiro_id: "a", nome: "Neon", horas_sem_contato: 60 },
        { ...base, parceiro_id: "b", nome: "Yvens", horas_sem_contato: 70, fechado_sem_contato: true,
          fechado_por_nome: "Jess", fechado_em: "2026-11-16T21:35:00Z" },
      ],
      { horas: 48, telefonesGestor: [] },
    );
    expect(texto).toContain("Bom dia! 1 parceiro sem contato da equipe há mais de 48 horas:");
    expect(texto).toContain("- Neon · 60h\n\nChamados fechados sem nenhuma mensagem:\n- Yvens · fechado por Jess em 16/11");
  });
  it("só fechados: sem o título da lista de abertos", () => {
    const texto = montarLembreteEquipe(
      [{ ...base, parceiro_id: "b", nome: "Wa", horas_sem_contato: 70, fechado_sem_contato: true,
         fechado_por_nome: "Maiara", fechado_em: "2026-11-16T21:30:00Z" }],
      { horas: 48, telefonesGestor: [] },
    );
    expect(texto.startsWith("Bom dia! \n\nChamados fechados sem nenhuma mensagem:\n- Wa · fechado por Maiara em 16/11")).toBe(true);
  });
  it("as duas listas juntas respeitam 15 linhas no total", () => {
    const linhas = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...base, parceiro_id: `a${i}`, nome: `A${i}`, horas_sem_contato: 50 })),
      ...Array.from({ length: 8 }, (_, i) => ({ ...base, parceiro_id: `f${i}`, nome: `F${i}`, horas_sem_contato: 70,
        fechado_sem_contato: true, fechado_por_nome: "Jess", fechado_em: "2026-11-16T21:30:00Z" })),
    ];
    const texto = montarLembreteEquipe(linhas, { horas: 48, telefonesGestor: [] });
    expect(texto.split("\n").filter((l) => l.startsWith("- ")).length).toBe(15);
    expect(texto).toContain("E mais 3.");
  });
});
