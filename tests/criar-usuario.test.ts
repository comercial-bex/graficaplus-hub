import { test, expect } from "vitest";
import {
  motivoParaNaoDesativar,
  motivoParaNaoMudarPermissao,
  motivoParaNaoRemoverPapel,
} from "../src/lib/criar-usuario";

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

// Desativar passou a bloquear de verdade (has_permission e is_staff exigem
// usuarios.ativo), então as travas contra ficar sem dono valem aqui também.
test("ninguém se desativa e fica sem sistema", () => {
  expect(
    motivoParaNaoDesativar({
      usuarioId: "u1",
      usuarioLogadoId: "u1",
      ehAdmin: false,
      totalDeAdminsAtivos: 3,
    }),
  ).toMatch(/sairia do sistema/i);
});

test("o último admin ativo não pode ser desativado", () => {
  expect(
    motivoParaNaoDesativar({
      usuarioId: "u2",
      usuarioLogadoId: "u1",
      ehAdmin: true,
      totalDeAdminsAtivos: 1,
    }),
  ).toMatch(/único administrador/i);
});

test("desativar outra pessoa que não é o último admin é permitido", () => {
  expect(
    motivoParaNaoDesativar({
      usuarioId: "u2",
      usuarioLogadoId: "u1",
      ehAdmin: true,
      totalDeAdminsAtivos: 2,
    }),
  ).toBeNull();
  expect(
    motivoParaNaoDesativar({
      usuarioId: "u3",
      usuarioLogadoId: "u1",
      ehAdmin: false,
      totalDeAdminsAtivos: 1,
    }),
  ).toBeNull();
});

test("o perfil admin não perde permissão pela matriz", () => {
  expect(motivoParaNaoMudarPermissao("admin")).toMatch(/rede de segurança|voltar atrás/i);
  expect(motivoParaNaoMudarPermissao("vendedor")).toBeNull();
});
