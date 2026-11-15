import { describe, it, expect } from "vitest";
import {
  montarTextoAviso,
  motivoDoIntervalo,
  pertenceAoPublico,
  quantidadePermitida,
  type DestinatarioAviso,
} from "@/domain/parceiros/avisos";
const p: DestinatarioAviso = {
  id: "p",
  nome: "Maria Silva",
  telefone: "62981234567",
  credito: 50,
  comprou: false,
  ultimo_aviso: null,
  status: "ativo",
  usuario_id: null,
};
describe("texto dos avisos", () => {
  it("preenche nome, saldo e link e inclui saída", () =>
    expect(montarTextoAviso("Olá {{nome}}: {{credito}} {{link}}", p)).toBe(
      "Olá Maria: R$ 50,00 https://bexprint.com.br/login?como=parceiro\n\nPara não receber estes avisos, responda SAIR.",
    ));
  it("não interpreta variável inserida como nome", () =>
    expect(montarTextoAviso("{{nome}}", { ...p, nome: "{{link}}" })).toBe(
      "{{link}}\n\nPara não receber estes avisos, responda SAIR.",
    ));
});
describe("público cadastrado", () => {
  it("inclui ativo com celular", () => expect(pertenceAoPublico(p, "ativos")).toBe(true));
  it.each([
    { status: "suspenso" },
    { telefone: "6232123456" },
    { nao_receber_avisos_em: "2026-11-15" },
  ])("exclui inelegível %j", (extra) =>
    expect(pertenceAoPublico({ ...p, ...extra }, "ativos")).toBe(false),
  );
  it("sem compra exclui comprador", () => {
    expect(pertenceAoPublico(p, "sem_compra")).toBe(true);
    expect(pertenceAoPublico({ ...p, comprou: true }, "sem_compra")).toBe(false);
  });
  it("crédito precisa de saldo positivo", () => {
    expect(pertenceAoPublico(p, "com_credito")).toBe(true);
    expect(pertenceAoPublico({ ...p, credito: 0 }, "com_credito")).toBe(false);
  });
  it("terceirizado já compra, com ou sem login", () => {
    expect(pertenceAoPublico({ ...p, comprou: true }, "terceirizados")).toBe(true);
    expect(pertenceAoPublico({ ...p, comprou: true, usuario_id: "login" }, "terceirizados")).toBe(
      true,
    );
    expect(pertenceAoPublico(p, "terceirizados")).toBe(false);
  });
});
describe("janela de sete dias", () => {
  const agora = new Date("2026-11-15T15:00:00Z");
  it("libera exatamente sete dias", () =>
    expect(motivoDoIntervalo("2026-11-08T15:00:00Z", agora)).toBeNull());
  it("recusa um segundo antes de sete dias", () =>
    expect(motivoDoIntervalo("2026-11-08T15:00:01Z", agora)).not.toBeNull());
  it("sem aviso anterior libera", () => expect(motivoDoIntervalo(null, agora)).toBeNull());
});
it("permite no máximo 50 destinatários por aviso", () => {
  expect(quantidadePermitida(Array.from({ length: 50 }, (_, i) => String(i)))).toBe(true);
  expect(quantidadePermitida(Array.from({ length: 51 }, (_, i) => String(i)))).toBe(false);
  expect(quantidadePermitida([])).toBe(false);
});
