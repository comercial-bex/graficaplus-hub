import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  linhaDoTempoDoCliente,
  mensagemDaNota,
  quandoPorExtenso,
  type NotaDoCliente,
} from "../src/domain/clientes/historico";

/**
 * Histórico do cliente com notas (01/11/2026), como a aba Histórico do Holdprint. As regras de quem lê,
 * escreve e apaga estão na migração `20261101200000_cliente_notas.sql`, ensaiadas no banco por perfil.
 */

const nota = (id: string, created_at: string, texto = id): NotaDoCliente => ({ id, texto, autor_id: "u1", created_at });

describe("a linha do tempo", () => {
  it("vai da nota mais nova à mais velha e fecha com o cadastro, que foi o primeiro fato", () => {
    const l = linhaDoTempoDoCliente(
      [nota("a", "2026-10-20T10:00:00Z"), nota("c", "2026-11-01T10:00:00Z"), nota("b", "2026-10-25T10:00:00Z")],
      "2026-10-01T09:00:00Z",
    );
    expect(l.map((x) => x.id)).toEqual(["c", "b", "a", "cadastro"]);
    expect(l[3]).toMatchObject({ tipo: "cadastro", texto: "Cliente cadastrado", autorId: null });
  });

  it("sem notas ainda sobra o cadastro, e sem data de cadastro não inventa linha", () => {
    expect(linhaDoTempoDoCliente([], "2026-10-01T09:00:00Z").map((x) => x.id)).toEqual(["cadastro"]);
    expect(linhaDoTempoDoCliente([], null)).toEqual([]);
  });

  it("não altera a lista que recebeu", () => {
    const notas = [nota("a", "2026-10-20T10:00:00Z"), nota("b", "2026-10-25T10:00:00Z")];
    linhaDoTempoDoCliente(notas, null);
    expect(notas.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("a data por extenso", () => {
  it("usa a hora de Macapá, qualquer que seja o fuso de quem olha", () => {
    // 15:30 UTC é 12:30 em Macapá (UTC-3)
    expect(quandoPorExtenso("2026-11-01T15:30:00Z")).toBe("01/11/2026, 12:30");
  });

  it("data que não lê vira traço, não 'Invalid Date'", () => {
    expect(quandoPorExtenso(null)).toBe("—");
    expect(quandoPorExtenso("lixo")).toBe("—");
  });
});

describe("a mensagem quando o banco recusa", () => {
  it("sem permissão diz quem pode", () => {
    expect(mensagemDaNota({ code: "42501" })).toMatch(/admin, gestor e vendedor/);
  });
  it("outro erro leva o motivo", () => {
    expect(mensagemDaNota({ message: "falhou" })).toContain("falhou");
    expect(mensagemDaNota(null)).toBe("Não consegui registrar a nota.");
  });
});

describe("a ficha do cliente e o banco", () => {
  const FICHA = readFileSync("src/routes/_authenticated/clientes.$id.tsx", "utf8");
  const TELA = readFileSync("src/components/cliente/historico-do-cliente.tsx", "utf8");
  const SQL = readFileSync("supabase/migrations/20261101200000_cliente_notas.sql", "utf8");
  const CODIGO = SQL.replace(/^\s*--.*$/gm, "");

  it("a ficha ganha a aba Histórico", () => {
    expect(FICHA).toContain('<TabsTrigger value="historico">Histórico</TabsTrigger>');
    expect(FICHA).toContain("<HistoricoDoCliente");
  });

  it("falha na consulta aparece como falha, nunca como 'sem notas'", () => {
    expect(TELA).toContain("notas.error ?");
    expect(TELA).toContain('role="alert"');
    // a frase de vazio só vale com a lista carregada e vazia
    expect(TELA).toContain("notas.data?.length === 0");
  });

  it("a nota tem limite de tamanho na tela e no banco", () => {
    expect(TELA).toContain("const LIMITE = 2000;");
    expect(CODIGO).toContain("length(btrim(texto)) BETWEEN 1 AND 2000");
  });

  it("o banco: leitura de quem vê o cliente, escrita em nome próprio de admin, gestor e vendedor, apagar só admin e gestor, nada de alterar nem de ALL", () => {
    expect(CODIGO).toContain("FOR SELECT TO authenticated");
    expect(CODIGO).toContain("has_permission((SELECT auth.uid()), 'clientes.read'::text)");
    expect(CODIGO).toContain("autor_id = (SELECT auth.uid())");
    expect(CODIGO).toContain("FOR INSERT TO authenticated");
    expect(CODIGO).toContain("FOR DELETE TO authenticated");
    expect(CODIGO).not.toMatch(/FOR ALL|FOR UPDATE/i);
    expect(CODIGO).toContain("GRANT SELECT, INSERT, DELETE ON public.cliente_notas TO authenticated;");
  });

  it("o público não toca na tabela e a RLS está ligada", () => {
    expect(CODIGO).toContain("REVOKE ALL ON public.cliente_notas FROM PUBLIC, anon;");
    expect(CODIGO).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("apagar o cliente leva as notas junto, e a migração não apaga nada de ninguém", () => {
    expect(CODIGO).toContain("REFERENCES public.clientes(id) ON DELETE CASCADE");
    expect(CODIGO).not.toMatch(/\b(DELETE FROM|DROP TABLE|TRUNCATE)\b/i);
  });
});
