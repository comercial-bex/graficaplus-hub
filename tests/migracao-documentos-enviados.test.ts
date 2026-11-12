import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A migração 20261112100000 lida como texto: as regras da casa que nenhum teste de banco falso vê.
 * (Quem ensaia e aplica no banco é o orquestrador.)
 */
const sql = readFileSync("supabase/migrations/20261112100000_documentos_enviados_pdf_ao_cliente.sql", "utf8");
const semComentarios = sql.replace(/--.*$/gm, "");

describe("migração documentos_enviados (PDF ao cliente)", () => {
  it("a função é SECURITY DEFINER com search_path fixo", () => {
    const corpo = semComentarios.match(/CREATE OR REPLACE FUNCTION public\.registrar_envio_documento[\s\S]*?\$\$;/);
    expect(corpo).not.toBeNull();
    expect(corpo![0]).toMatch(/SECURITY DEFINER/);
    expect(corpo![0]).toMatch(/SET search_path = public/);
  });

  it("revoga de PUBLIC, anon e authenticated por extenso e libera só o service_role", () => {
    expect(semComentarios).toMatch(
      /REVOKE ALL ON FUNCTION public\.registrar_envio_documento\(uuid, text, uuid, text, uuid, uuid, uuid\) FROM PUBLIC, anon, authenticated;/,
    );
    const grants = semComentarios.match(/GRANT EXECUTE ON FUNCTION[^;]*;/g) ?? [];
    expect(grants).toHaveLength(3);
    for (const g of grants) {
      expect(g).toMatch(/TO service_role;$/);
      expect(g).not.toMatch(/anon|authenticated|PUBLIC/);
    }
    for (const assinatura of ["confirmar_envio_documento\\(uuid, uuid\\)", "arquivo_do_pdf_gerado\\(text\\)"]) {
      expect(semComentarios).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${assinatura} FROM PUBLIC, anon, authenticated;`),
      );
    }
  });

  it("toda função nova é SECURITY DEFINER com search_path fixo", () => {
    const corpos = semComentarios.match(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$\$;/g) ?? [];
    expect(corpos).toHaveLength(3);
    for (const c of corpos) {
      expect(c).toMatch(/SECURITY DEFINER/);
      expect(c).toMatch(/SET search_path = public/);
    }
  });

  it("status e enviado_em pelo sistema esperam a mensagem sair, e só em rascunho ou enviado", () => {
    const registrar = semComentarios.match(/FUNCTION public\.registrar_envio_documento[\s\S]*?\$\$;/)![0];
    expect(registrar).toMatch(/p_canal = 'wa_me'/);
    expect(registrar).not.toMatch(/ELSIF v_sem_data/);
    const confirmar = semComentarios.match(/FUNCTION public\.confirmar_envio_documento[\s\S]*?\$\$;/)![0];
    expect(confirmar).toMatch(/NOT IN \('enviada', 'entregue', 'lida'\)/);
    expect(confirmar).toMatch(/v_status = 'enviado' AND v_sem_data/);
  });

  it("a vista só conta como efetivo o envio cuja mensagem saiu", () => {
    expect(semComentarios).toMatch(/m\.status::text IN \('enviada', 'entregue', 'lida'\)/);
  });

  it("o objeto do PDF é lido do Storage pela chave de serviço", () => {
    expect(semComentarios).toMatch(/FROM storage\.objects o\s+WHERE o\.bucket_id = 'documentos-pdf'/);
  });

  it("a tabela nasce com RLS, sem anon e sem escrita para authenticated", () => {
    expect(semComentarios).toMatch(/ALTER TABLE public\.documentos_enviados ENABLE ROW LEVEL SECURITY;/);
    expect(semComentarios).toMatch(/REVOKE ALL ON TABLE public\.documentos_enviados FROM PUBLIC, anon, authenticated;/);
    expect(semComentarios).toMatch(/GRANT SELECT ON TABLE public\.documentos_enviados TO authenticated;/);
    expect(semComentarios).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("a vista é security_invoker e não lê orcamentos nem ordens_servico", () => {
    const vista = semComentarios.match(/CREATE OR REPLACE VIEW public\.vw_envio_dos_documentos[\s\S]*?;\s*$/m);
    expect(semComentarios).toMatch(/CREATE OR REPLACE VIEW public\.vw_envio_dos_documentos\s+WITH \(security_invoker = true\)/);
    expect(vista).not.toBeNull();
    expect(vista![0]).not.toMatch(/public\.orcamentos\b|ordens_servico/);
    expect(semComentarios).toMatch(/REVOKE ALL ON public\.vw_envio_dos_documentos FROM PUBLIC, anon, authenticated;/);
  });

  it("não usa CURRENT_DATE, e grava o evento e o enviado_em só quando nulo", () => {
    expect(semComentarios).not.toMatch(/CURRENT_DATE/);
    expect(semComentarios).toMatch(/INSERT INTO public\.eventos_negocio/);
    expect(semComentarios).toMatch(/enviado_em = coalesce\(enviado_em, v_em\)/);
  });

  it("o payload da mensagem ganha orcamento_id ou os_id", () => {
    expect(semComentarios).toMatch(/'orcamento_id'/);
    expect(semComentarios).toMatch(/'os_id'/);
  });
});
