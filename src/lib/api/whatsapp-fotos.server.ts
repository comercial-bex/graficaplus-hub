/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TAMANHO_MAXIMO_DA_FOTO,
  caminhoDaFoto,
  chaveDaFoto,
  ehImagem,
  fotoDoEvento,
  linkAindaVale,
  linkDaRespostaDoZapi,
  precisaGuardar,
  urlDeFotoConfiavel,
} from "@/domain/whatsapp/foto-do-contato";

/**
 * A foto do contato, do lado do servidor (pedido do dono em 14/10/2026).
 *
 * Dois caminhos, nenhum deles gasta crédito:
 *   1. O webhook: todo ReceivedCallback traz `photo`. Mudou a foto (ou a
 *      conversa ainda não tem), baixa e guarda. Roda depois da mensagem já
 *      gravada e nunca derruba o 200 — foto é enfeite, mensagem não.
 *   2. As pendentes (POST /api/whatsapp/fotos, pelo pg_cron): conversas sem
 *      foto. Usa a última foto que o webhook viu (se o link ainda vale) ou
 *      pergunta ao Z-API (GET /profile-picture). Sem foto, anota a tentativa e
 *      só volta a tentar em 7 dias (whatsapp_fotos_pendentes).
 */

const BUCKET = "whatsapp-midias";
const TEMPO_MAXIMO_MS = 8_000;

type Buscar = typeof fetch;

async function comTeto(url: string, init: RequestInit, buscar: Buscar): Promise<Response> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_MAXIMO_MS);
  try {
    return await buscar(url, { ...init, signal: controle.signal });
  } finally {
    clearTimeout(relogio);
  }
}

/** Baixa a foto e grava a cópia; atualiza a conversa. Lança com o motivo. */
export async function guardarFoto(
  conversaId: string,
  url: URL,
  buscar: Buscar = fetch,
): Promise<{ caminho: string; bytes: number }> {
  const r = await comTeto(url.toString(), {}, buscar);
  if (!r.ok) throw new Error(`o WhatsApp devolveu ${r.status} ao baixar a foto`);
  const declarado = Number(r.headers.get("content-length") ?? 0);
  if (declarado > TAMANHO_MAXIMO_DA_FOTO) throw new Error("foto grande demais");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > TAMANHO_MAXIMO_DA_FOTO) {
    throw new Error(`foto com ${bytes.byteLength} bytes`);
  }
  const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim() || null;
  if (!ehImagem(tipo, bytes)) throw new Error(`o link não devolveu imagem (${tipo ?? "sem tipo"})`);

  const caminho = caminhoDaFoto(conversaId);
  const { error: erroUpload } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(caminho, bytes, { contentType: tipo ?? "image/jpeg", upsert: true });
  if (erroUpload) throw new Error(`falha ao guardar a foto: ${erroUpload.message}`);

  const agora = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("whatsapp_conversas")
    .update({
      foto_path: caminho,
      foto_chave: chaveDaFoto(url),
      foto_atualizada_em: agora,
      foto_tentativa_em: agora,
    } as never)
    .eq("id", conversaId);
  if (error) throw new Error(`foto guardada, conversa não atualizada: ${error.message}`);
  return { caminho, bytes: bytes.byteLength };
}

/**
 * Do webhook: a foto que veio no evento, se a conversa ainda não tem esta.
 * Devolve o que fez (para a resposta do webhook); nunca lança.
 */
export async function fotoPeloWebhook(
  payload: unknown,
  instanciaId: string,
  buscar: Buscar = fetch,
): Promise<string | null> {
  const foto = fotoDoEvento(payload);
  if (!foto) return null;
  try {
    const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_conversa_do_telefone", {
      p_instancia_id: instanciaId,
      p_telefone: foto.telefone,
    });
    if (error) return `foto: ${error.message}`;
    const conversa = ((data ?? []) as { conversa_id: string; foto_path: string | null; foto_chave: string | null }[])[0];
    if (!conversa) return null; // contato sem conversa (ex.: eco de aviso a número novo)
    if (!precisaGuardar(conversa, foto.chave)) return "foto: a mesma";
    await guardarFoto(conversa.conversa_id, foto.url, buscar);
    return "foto: guardada";
  } catch (e) {
    return `foto: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type ResultadoDasFotos = {
  guardadas: number;
  sem_foto: number;
  falhas: { conversa_id: string; erro: string }[];
};

/** A foto pelo Z-API (GET /profile-picture). `null` = o contato não mostra foto. */
async function linkPeloZapi(
  telefone: string,
  credenciais: { instanceId: string; token: string; clientToken: string },
  buscar: Buscar,
): Promise<URL | null> {
  const endereco =
    `https://api.z-api.io/instances/${credenciais.instanceId}/token/${credenciais.token}` +
    `/profile-picture?phone=${encodeURIComponent(telefone)}`;
  const r = await comTeto(
    endereco,
    { headers: credenciais.clientToken ? { "Client-Token": credenciais.clientToken } : {} },
    buscar,
  );
  if (!r.ok) throw new Error(`Z-API devolveu ${r.status} ao pedir a foto`);
  return linkDaRespostaDoZapi(await r.json().catch(() => null));
}

/**
 * As conversas sem foto, poucas por vez. Para cada uma: a última foto do
 * webhook, se o link ainda vale; senão o Z-API. Sem foto, anota a tentativa.
 */
export async function fotosPendentes(limite = 5, buscar: Buscar = fetch): Promise<ResultadoDasFotos> {
  const resultado: ResultadoDasFotos = { guardadas: 0, sem_foto: 0, falhas: [] };
  const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_fotos_pendentes", { p_limite: limite });
  if (error) throw new Error(`falha ao listar as fotos pendentes: ${error.message}`);
  const pendentes = (data ?? []) as { conversa_id: string; instancia_id: string; telefone: string; ultima_foto: string | null }[];
  if (pendentes.length === 0) return resultado;

  // Uma instância só (a gráfica opera uma) — a mesma regra do despachante.
  const { data: instancia } = await supabaseAdmin
    .from("whatsapp_instancias")
    .select("zapi_instance_id")
    .eq("ativa", true)
    .limit(1)
    .maybeSingle();
  const credenciais = {
    instanceId: (instancia?.zapi_instance_id as string | undefined) ?? "",
    token: process.env.ZAPI_TOKEN ?? "",
    clientToken: process.env.ZAPI_CLIENT_TOKEN ?? "",
  };
  const agora = new Date();

  for (const p of pendentes) {
    try {
      let url = urlDeFotoConfiavel(p.ultima_foto);
      if (url && !linkAindaVale(url, agora)) url = null;
      if (!url) {
        if (!credenciais.instanceId || !credenciais.token) throw new Error("sem ZAPI_TOKEN ou instância no servidor");
        url = await linkPeloZapi(p.telefone, credenciais, buscar);
      }
      if (url) {
        await guardarFoto(p.conversa_id, url, buscar);
        resultado.guardadas += 1;
        continue;
      }
      resultado.sem_foto += 1;
    } catch (e) {
      resultado.falhas.push({ conversa_id: p.conversa_id, erro: e instanceof Error ? e.message : String(e) });
    }
    // Sem foto ou com falha: anota a tentativa (volta em 7 dias).
    await supabaseAdmin
      .from("whatsapp_conversas")
      .update({ foto_tentativa_em: agora.toISOString() } as never)
      .eq("id", p.conversa_id);
  }
  return resultado;
}
