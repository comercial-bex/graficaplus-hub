import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Lê o ARQUIVO do fatiador (.3mf do Bambu Studio/Orca, .gcode do Cura/Prusa) e devolve peso e
 * tempo, por placa (27/10/2026).
 *
 * O leitor (`domain/impressao3d/slicer-import`) existia desde o módulo 3D e nunca foi ligado a
 * uma tela: a calculadora só lia o PRINT por OCR, que erra vírgula e confunde "12,5 m" com
 * "12,5 g". O arquivo tem o número exato. Ele sobe para `orcamentos-3d/<instante>_slicer_…` (a
 * mesma pasta do print; a regra do Storage já libera para quem cria orçamento 3D) e o servidor
 * abre o ZIP e lê o `slice_info.config`. Roda só no servidor: o leitor usa zlib e crypto do Node.
 */
const CAMINHO_DO_FATIADOR = /^orcamentos-3d\/[0-9]+_slicer_[A-Za-z0-9._-]+\.(3mf|gcode)$/i;

export const lerArquivoDoFatiador = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ caminho: z.string().regex(CAMINHO_DO_FATIADOR, "caminho inválido") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: pode, error: erroPermissao } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _permission: "orcamentos.create",
    });
    if (erroPermissao) throw new Error(erroPermissao.message);
    if (!pode) throw new Error("Seu perfil não cria orçamentos.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: blob, error: erroBaixa } = await supabaseAdmin.storage.from("arquivos-clientes").download(data.caminho);
    if (erroBaixa || !blob) throw new Error(erroBaixa?.message || "Não consegui abrir o arquivo enviado.");

    const { parseSlicerImport } = await import("@/domain/impressao3d/slicer-import");
    const nome = data.caminho.replace(/^.*\//, "").replace(/^[0-9]+_slicer_/, "");
    const r = parseSlicerImport(Buffer.from(await blob.arrayBuffer()), nome);
    return {
      parser: r.parser,
      totalTimeSeconds: r.data.totalTimeSeconds ?? null,
      totalWeightG: r.data.totalWeightG ?? null,
      plates: r.data.plates.map((p) => ({ name: p.name, timeSeconds: p.timeSeconds ?? null, weightG: p.weightG ?? null })),
      found: r.data.found,
      missing: r.data.missing,
    };
  });
