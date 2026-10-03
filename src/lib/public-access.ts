import { supabase } from "@/integrations/supabase/client";
import {
  CABECALHO_DO_LINK,
  MENSAGEM_LINK_INVALIDO,
  ROTAS_DO_PORTAL,
} from "@/domain/portal/link-do-portal";
import type { PainelDoLink } from "@/domain/portal/painel-do-cliente";
import type { TipoDeEnvio, TipoDeMensagem } from "@/domain/portal/envio-de-arquivo";
import { mensagemErro } from "@/lib/erros";

/**
 * O navegador do cliente falando com as rotas do portal por link.
 *
 * Este arquivo era a DEMONSTRAÇÃO: um cliente e um orçamento fictícios
 * ("orc-245", "Marcos Silva", "Banner lona 440g") devolvidos para QUALQUER
 * token, e um `public-access.server.ts` que assinava token com um segredo
 * escrito no código e respondia "Recebemos sua solicitação… A equipe foi
 * notificada." sem gravar nada. Os dois saíram.
 *
 * Agora cada função chama uma rota de servidor com o token no cabeçalho, e
 * toda resposta que não é 200 vira um `ErroDoPortal` com o motivo — a página
 * nunca mostra "enviado" sem a gravação ter acontecido.
 */

export type MotivoDoErro =
  | "link_invalido"
  | "recusado"
  | "nao_encontrado"
  | "fora_do_ar"
  | "sem_conexao";

export class ErroDoPortal extends Error {
  constructor(
    public readonly motivo: MotivoDoErro,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDoPortal";
  }
}

async function chamar(
  token: string,
  rota: string,
  corpo?: unknown,
): Promise<Record<string, unknown>> {
  let resposta: Response;
  try {
    resposta = await fetch(rota, {
      method: corpo === undefined ? "GET" : "POST",
      headers: {
        [CABECALHO_DO_LINK]: token,
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
    });
  } catch {
    throw new ErroDoPortal(
      "sem_conexao",
      "Sem conexão com a Bex Print. Confira a internet do celular e tente de novo.",
    );
  }

  let dados: Record<string, unknown> | null = null;
  try {
    const lido: unknown = await resposta.json();
    if (lido && typeof lido === "object" && !Array.isArray(lido))
      dados = lido as Record<string, unknown>;
  } catch {
    dados = null;
  }
  const motivo = typeof dados?.mensagem === "string" ? dados.mensagem : null;

  if (resposta.status === 200 && dados) return dados;
  if (resposta.status === 401) throw new ErroDoPortal("link_invalido", MENSAGEM_LINK_INVALIDO);
  if (resposta.status === 400 || resposta.status === 422) {
    throw new ErroDoPortal("recusado", motivo ?? "Não foi possível concluir. Confira os dados.");
  }
  if (resposta.status === 404) {
    throw new ErroDoPortal(
      "nao_encontrado",
      motivo ?? "Arquivo não encontrado entre os seus pedidos.",
    );
  }
  throw new ErroDoPortal(
    "fora_do_ar",
    'O portal não respondeu agora. Tente de novo em alguns minutos — se mandou arquivo, confira antes em "O que você já mandou".',
  );
}

export async function abrirPainel(token: string): Promise<PainelDoLink> {
  return (await chamar(token, ROTAS_DO_PORTAL.painel)) as unknown as PainelDoLink;
}

export type Gravado = { protocolo: string; os_numero: number | null };

/**
 * Manda o arquivo em três passos: a rota prepara uma URL assinada para a pasta
 * do cliente, o arquivo sobe direto para o Storage, e a rota confirma — é o
 * banco que confere se o arquivo chegou e grava.
 */
export async function enviarArquivo(
  token: string,
  dados: { tipo: TipoDeEnvio; osId: string | null; arquivo: File; mensagem: string },
): Promise<Gravado> {
  const preparo = await chamar(token, ROTAS_DO_PORTAL.envio, {
    acao: "preparar",
    tipo: dados.tipo,
    os_id: dados.osId,
    nome: dados.arquivo.name,
    tamanho: dados.arquivo.size,
  });
  const bucket = String(preparo.bucket ?? "");
  const caminho = String(preparo.caminho ?? "");
  const assinatura = String(preparo.assinatura ?? "");
  if (!bucket || !caminho || !assinatura) {
    throw new ErroDoPortal("fora_do_ar", "O portal não preparou o envio. Tente de novo.");
  }

  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(caminho, assinatura, dados.arquivo, {
      contentType: dados.arquivo.type || undefined,
    });
  if (error) {
    throw new ErroDoPortal("recusado", mensagemErro(error, "O arquivo não subiu. Tente de novo."));
  }

  const gravado = await chamar(token, ROTAS_DO_PORTAL.envio, {
    acao: "confirmar",
    tipo: dados.tipo,
    os_id: dados.osId,
    nome: dados.arquivo.name,
    caminho,
    mensagem: dados.mensagem.trim() || null,
  });
  return {
    protocolo: String(gravado.protocolo ?? ""),
    os_numero: (gravado.os_numero as number) ?? null,
  };
}

export async function decidirArte(
  token: string,
  dados: { arquivoId: string; decisao: "aprovado" | "ajuste"; comentario: string },
): Promise<{ os_numero: number | null }> {
  const r = await chamar(token, ROTAS_DO_PORTAL.arte, {
    arquivo_id: dados.arquivoId,
    decisao: dados.decisao,
    comentario: dados.comentario.trim() || null,
  });
  return { os_numero: (r.os_numero as number) ?? null };
}

export async function urlDoArquivo(
  token: string,
  dados: { tipo: "arquivo" | "documento"; id: string; para: "ver" | "baixar" },
): Promise<{ url: string; nome: string; mime: string | null }> {
  const r = await chamar(token, ROTAS_DO_PORTAL.arquivo, dados);
  const url = typeof r.url === "string" ? r.url : "";
  if (!url) throw new ErroDoPortal("fora_do_ar", "O portal não abriu o arquivo. Tente de novo.");
  return {
    url,
    nome: String(r.nome ?? "arquivo"),
    mime: typeof r.mime === "string" ? r.mime : null,
  };
}

export async function enviarMensagem(
  token: string,
  dados: { tipo: TipoDeMensagem; osId: string | null; mensagem: string },
): Promise<Gravado> {
  const r = await chamar(token, ROTAS_DO_PORTAL.mensagem, {
    tipo: dados.tipo,
    os_id: dados.osId,
    mensagem: dados.mensagem.trim(),
  });
  return { protocolo: String(r.protocolo ?? ""), os_numero: (r.os_numero as number) ?? null };
}
