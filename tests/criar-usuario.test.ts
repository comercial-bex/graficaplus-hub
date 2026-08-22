import { test, expect } from "vitest";
import { motivoParaNaoRemoverPapel } from "../src/lib/criar-usuario";

// Papel some com um clique. Sem estas travas o admin remove o próprio admin e
// ninguém mais consegue atribuir papel a ninguém — só admin escreve user_roles.

test("papel comum pode ser removido sem cerimônia", () => {
  expect(
    motivoParaNaoRemoverPapel({
      papel: "designer",
      usuarioId: "u1",
      usuarioLogadoId: "u1",
      totalDeAdmins: 1,
    }),
  ).toBeNull();
});

test("o único administrador não pode ser rebaixado", () => {
  expect(
    motivoParaNaoRemoverPapel({
      papel: "admin",
      usuarioId: "u2",
      usuarioLogadoId: "u1",
      totalDeAdmins: 1,
    }),
  ).toMatch(/único administrador/i);
});

test("admin não remove o próprio admin", () => {
  expect(
    motivoParaNaoRemoverPapel({
      papel: "admin",
      usuarioId: "u1",
      usuarioLogadoId: "u1",
      totalDeAdmins: 3,
    }),
  ).toMatch(/perderia o acesso/i);
});

test("admin pode remover o admin de outra pessoa quando há mais de um", () => {
  expect(
    motivoParaNaoRemoverPapel({
      papel: "admin",
      usuarioId: "u2",
      usuarioLogadoId: "u1",
      totalDeAdmins: 2,
    }),
  ).toBeNull();
});
