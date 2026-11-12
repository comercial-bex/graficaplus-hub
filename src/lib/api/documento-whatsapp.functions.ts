import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MOTIVO_DESCONECTADO,
  PERMISSOES_PARA_ENVIAR,
  PERMISSOES_PARA_REGISTRAR_POR_FORA,
  chavesParaConferir,
  documentoServeParaEnvio,
  envioRepetido,
  instanciaConectada,
  instanciaDoEnvio,
  legendaDoDocumento,
  nomeDoArquivo,
  objetoServeParaEnvio,
  pixDoSinalPodeSair,
  podeEnviarDocumento,
  podeRegistrarPorFora,
  telefoneDoEnvio,
  type InstanciaParaEnvio,
  type LinhaDoDocumentoGerado,
  type ObjetoDoStorage,
  type RegraDePermissao,
  type TipoDeDocumento,
} from "@/domain/whatsapp/envio-de-documento";

/**
 * "Enviar PDF ao cliente" (onda "PDF ao cliente", 12/11/2026): a ÚNICA porta para o PDF do
 * orçamento, da OS ou do orçamento 3D ir à conversa do cliente pelo WhatsApp da gráfica. O passo 4
 * do orçamento, o cabeçalho da OS (e o menu Mais), a tela do 3D, a prévia do PDF (via do cliente) e o
 * painel "Ligados a esta conversa" chamam esta mesma função.
 *
 * Exceção registrada no AGENTS.md: mora fora de `whatsapp-caixa.functions.ts`, mas segue a mesma
 * regra. O servidor confere a permissão de quem chama e só então chama as funções SQL SECURITY
 * DEFINER que só o service_role executa (`whatsapp_responder_arquivo`, `registrar_envio_documento`).
 * Nada sai sem o clique de uma pessoa da equipe.
 *
 * A ordem importa: nada é escrito (nem conversa criada, nem cópia do arquivo) antes de conferir a
 * permissão, a linha de `documentos_gerados` e a conexão do WhatsApp.
 */

export const pedidoDeEnvioSchema = z.object({
  tipo: z.enum(["orcamento", "os", "orcamento_3d"]),
  /** O orçamento, a OS ou o orçamento 3D. */
  referenciaId: z.string().uuid(),
  /**
   * A linha de `documentos_gerados` (via do cliente) que a tela acabou de gerar. `null` só no
   * orçamento, depois de a pessoa responder "sim" a "Mandar só o link?": vai o texto com o link.
   */
  documentoId: z.string().uuid().nullable(),
  /** Só o painel da conversa: manda NESTA conversa, que tem de estar ligada ao documento. */
  conversaId: z.string().uuid().optional(),
});

/**
 * A origem pública do link de aprovação vem do servidor (PUBLIC_APP_URL), nunca da tela: um domínio de
 * preview ou uma chamada direta não mandam ao cliente um link de outro endereço.
 */
export function origemPublica(): string {
  const bruta = process.env.PUBLIC_APP_URL || "https://bexprint.com.br";
  try {
    return new URL(bruta).origin;
  } catch {
    return "https://bexprint.com.br";
  }
}

export type PedidoDeEnvioDoDocumento = z.infer<typeof pedidoDeEnvioSchema>;

export type RegistroDoEnvio =
  | { ok: true; envioId: string; statusMudou: boolean; enviadoEmGravado: boolean }
  | { ok: false; motivo: string };

export type ResultadoDoEnvioDoDocumento = {
  conversaId: string;
  mensagemId: string;
  /** A linha de `whatsapp_fila_envio`: a tela diz o desfecho DELA depois de acionar o despachante. */
  filaId: string;
  comPdf: boolean;
  nomeArquivo: string | null;
  /** Só orçamento. */
  link: string | null;
  /** Só orçamento: o Pix do sinal, que segue depois do PDF, idêntico a hoje. */
  pix: { enviado: boolean; valor: number; motivo: string | null } | null;
  /** O registro em `documentos_enviados`. Falhar aqui NÃO desfaz o envio: a tela avisa. */
  registro: RegistroDoEnvio;
};

/** Os clientes do banco: o da sessão (has_permission, orcamento_link_publico) e o da chave de serviço. */
type Orc = import("./orcamento-whatsapp.functions").Orc;

export type DependenciasDoEnvio = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usuario: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  usuarioId: string;
  agora?: () => Date;
};

/** Pergunta ao banco, com a sessão de quem chama, cada chave da regra. */
async function permissoesDe(dep: DependenciasDoEnvio, regra: RegraDePermissao): Promise<(p: string) => boolean> {
  const tem = new Map<string, boolean>();
  for (const chave of chavesParaConferir(regra)) {
    const { data, error } = await dep.usuario.rpc("has_permission", {
      _user_id: dep.usuarioId,
      _permission: chave,
    });
    if (error) throw new Error(error.message || "Não consegui conferir a sua permissão.");
    tem.set(chave, data === true);
  }
  return (p: string) => tem.get(p) === true;
}

async function lerUma(consulta: PromiseLike<{ data: any; error: { message?: string } | null }>) {
  const { data, error } = await consulta;
  if (error) throw new Error(error.message || "Não consegui ler o banco.");
  return data ?? null;
}

/** O que o servidor precisa saber do documento para montar o envio. */
type Referencia = {
  numero: number | string;
  titulo: string | null;
  telefone: string | null;
  nome: string | null;
  /** Orçamento: a linha que o Pix do sinal usa (idêntica a hoje). */
  orc: Orc | null;
  /** Orçamento: a conversa já ligada a ele. */
  conversaLigada: string | null;
};

async function lerReferencia(admin: any, tipo: TipoDeDocumento, id: string): Promise<Referencia> {
  const cliente = async (clienteId: string | null) =>
    clienteId
      ? ((await lerUma(
          admin.from("clientes").select("nome, whatsapp_principal, telefone").eq("id", clienteId).maybeSingle(),
        )) as { nome: string | null; whatsapp_principal: string | null; telefone: string | null } | null)
      : null;

  if (tipo === "orcamento") {
    const orc = await lerUma(
      admin
        .from("orcamentos")
        .select(
          "id, numero, titulo, status, contato_nome, contato_telefone, cliente_id, valor_total, condicao_pagamento, conversa_id, os_id",
        )
        .eq("id", id)
        .maybeSingle(),
    );
    if (!orc) throw new Error("Documento não encontrado.");
    const cli = await cliente(orc.cliente_id);
    return {
      numero: orc.numero,
      titulo: orc.titulo ?? null,
      telefone: telefoneDoEnvio({ doDocumento: orc.contato_telefone, doCliente: cli }),
      nome: orc.contato_nome || cli?.nome || null,
      orc: orc as Orc,
      conversaLigada: orc.conversa_id ?? null,
    };
  }

  if (tipo === "os") {
    const os = await lerUma(
      admin.from("ordens_servico").select("id, numero, titulo, cliente_id, orcamento_id").eq("id", id).maybeSingle(),
    );
    if (!os) throw new Error("Documento não encontrado.");
    const origem = os.orcamento_id
      ? await lerUma(
          admin.from("orcamentos").select("contato_nome, contato_telefone").eq("id", os.orcamento_id).maybeSingle(),
        )
      : null;
    const cli = await cliente(os.cliente_id);
    return {
      numero: os.numero,
      titulo: os.titulo ?? null,
      telefone: telefoneDoEnvio({ doOrcamento: origem?.contato_telefone, doCliente: cli }),
      nome: origem?.contato_nome || cli?.nome || null,
      orc: null,
      conversaLigada: null,
    };
  }

  const t3d = await lerUma(
    admin
      .from("orcamentos_3d")
      .select("id, titulo, cliente_id, contato_nome, contato_telefone, orcamento_id, os_id")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!t3d) throw new Error("Documento não encontrado.");
  const doOrc = t3d.orcamento_id
    ? await lerUma(admin.from("orcamentos").select("numero, contato_telefone").eq("id", t3d.orcamento_id).maybeSingle())
    : null;
  const cli = await cliente(t3d.cliente_id);
  return {
    // O mesmo número do PDF (numeroNoFunil em generate.ts): o do orçamento; sem ele, o código do 3D.
    numero: doOrc?.numero ?? String(t3d.id).slice(0, 8).toUpperCase(),
    titulo: t3d.titulo ?? null,
    telefone: telefoneDoEnvio({ doDocumento: t3d.contato_telefone, doOrcamento: doOrc?.contato_telefone, doCliente: cli }),
    nome: t3d.contato_nome || cli?.nome || null,
    orc: null,
    conversaLigada: null,
  };
}

const COLUNAS_DA_INSTANCIA = "id, ativa, conectado, status, created_at";

async function instanciaPorId(admin: any, id: string | null): Promise<InstanciaParaEnvio | null> {
  if (!id) return null;
  return (await lerUma(
    admin.from("whatsapp_instancias").select(COLUNAS_DA_INSTANCIA).eq("id", id).maybeSingle(),
  )) as InstanciaParaEnvio | null;
}

/** O envio inteiro, sem o createServerFn: é o que os testes chamam com banco falso. */
export async function executarEnvioDoDocumento(
  dep: DependenciasDoEnvio,
  pedido: PedidoDeEnvioDoDocumento,
): Promise<ResultadoDoEnvioDoDocumento> {
  const agora = dep.agora?.() ?? new Date();
  const { tipo, referenciaId, documentoId } = pedido;
  const admin = dep.admin;

  // 1. Permissão de quem chama (com a sessão dele).
  const tem = await permissoesDe(dep, PERMISSOES_PARA_ENVIAR[tipo]);
  const permissao = podeEnviarDocumento(tipo, tem);
  if (!permissao.pode) throw new Error(permissao.motivo);

  // 2. Sem PDF só o orçamento (o texto com o link de aprovação), e só depois do "Mandar só o link".
  if (documentoId === null && tipo !== "orcamento") {
    throw new Error("Sem o PDF não há o que mandar: gere o PDF de novo.");
  }

  // 3. O documento.
  const ref = await lerReferencia(admin, tipo, referenciaId);

  // 4. A linha de documentos_gerados: só a via do cliente deste documento, gerada por quem manda, agora.
  let linha: LinhaDoDocumentoGerado | null = null;
  if (documentoId !== null) {
    linha = (await lerUma(
      admin
        .from("documentos_gerados")
        .select("id, tipo, referencia_id, variante, caminho, gerado_por, created_at")
        .eq("id", documentoId)
        .maybeSingle(),
    )) as LinhaDoDocumentoGerado | null;
    const conferencia = documentoServeParaEnvio(linha, { tipo, referenciaId, usuarioId: dep.usuarioId }, agora);
    if (!conferencia.ok) throw new Error(conferencia.motivo);
    // A linha é escrita pelo navegador (policy "docs insert"): confere também o objeto no Storage, cujo
    // dono e hora o navegador não escolhe, e o formato do nome da via do cliente.
    const { data: objeto, error: erroObjeto } = await admin.rpc("arquivo_do_pdf_gerado", { p_caminho: linha!.caminho });
    if (erroObjeto) throw new Error("Não consegui conferir o arquivo do PDF. Nada foi enviado.");
    const doObjeto = objetoServeParaEnvio(
      linha!.caminho,
      { tipo, referenciaId, usuarioId: dep.usuarioId },
      (objeto ?? null) as ObjetoDoStorage,
      agora,
    );
    if (!doObjeto.ok) throw new Error(doObjeto.motivo);
  }

  // 5. A conexão, ANTES de qualquer escrita (conversa nova, cópia do arquivo, fila).
  let conversaId: string | null = null;
  let instanciaConferida: InstanciaParaEnvio | null = null;
  if (pedido.conversaId) {
    const conversa = await lerUma(
      admin.from("whatsapp_conversas").select("id, instancia_id, os_id").eq("id", pedido.conversaId).maybeSingle(),
    );
    if (!conversa) throw new Error("Conversa não encontrada.");
    const ligada =
      tipo === "orcamento"
        ? ref.conversaLigada === conversa.id
        : tipo === "os"
          ? conversa.os_id === referenciaId
          : false;
    if (!ligada) {
      throw new Error(
        tipo === "orcamento_3d"
          ? "O orçamento 3D não sai pelo painel da conversa: mande pela tela do orçamento 3D."
          : "Este documento não está ligado a esta conversa. Ligue antes de mandar.",
      );
    }
    instanciaConferida = await instanciaPorId(admin, conversa.instancia_id ?? null);
    if (!instanciaConectada(instanciaConferida)) throw new Error(MOTIVO_DESCONECTADO);
    conversaId = conversa.id as string;
  } else {
    const ativas = ((await lerUma(
      admin.from("whatsapp_instancias").select(COLUNAS_DA_INSTANCIA).eq("ativa", true),
    )) ?? []) as InstanciaParaEnvio[];
    instanciaConferida = instanciaDoEnvio(ativas);
    if (!instanciaConectada(instanciaConferida)) throw new Error(MOTIVO_DESCONECTADO);
  }

  // 6. O link de aprovação (orçamento), com a sessão de quem clicou: o banco confere orcamentos.send.
  let link: string | null = null;
  if (tipo === "orcamento") {
    const { data: token, error: erroLink } = await dep.usuario.rpc("orcamento_link_publico", {
      p_orcamento_id: referenciaId,
    });
    if (erroLink) throw new Error(erroLink.message || "Não foi possível gerar o link do cliente.");
    if (typeof token !== "string" || !token) throw new Error("O banco não devolveu o link do cliente.");
    link = `${origemPublica()}/orcamento-publico/${token}`;
  }

  // 7. Para quem vai: a conversa do telefone (acha a existente ou abre uma).
  if (!conversaId) {
    if (!ref.telefone) throw new Error("Sem telefone: preencha o celular no orçamento ou no cadastro do cliente.");
    const { data: conversa, error: erroConversa } = await admin.rpc("whatsapp_conversa_do_numero", {
      p_telefone: ref.telefone,
      p_nome: ref.nome,
      p_usuario: dep.usuarioId,
    });
    if (erroConversa) throw new Error(erroConversa.message);
    conversaId = (conversa as { id: string } | null)?.id ?? null;
    if (!conversaId) throw new Error("O banco não devolveu a conversa do cliente.");
    // A conversa que já existia pode ser de outra instância: confere a dela antes de copiar.
    const daConversa = await lerUma(
      admin.from("whatsapp_conversas").select("id, instancia_id").eq("id", conversaId).maybeSingle(),
    );
    const outra = daConversa?.instancia_id ?? null;
    if (outra && outra !== instanciaConferida?.id) {
      if (!instanciaConectada(await instanciaPorId(admin, outra))) throw new Error(MOTIVO_DESCONECTADO);
    }
  }

  // 8b. Sem trava de duplicado a cada clique, dois botões abertos mandariam duas cópias (e dois Pix).
  {
    const { data: anteriores, error: erroAnteriores } = await admin
      .from("documentos_enviados")
      .select("documento_id, conversa_id, enviado_em")
      .eq("tipo", tipo)
      .eq("referencia_id", referenciaId)
      .eq("canal", "whatsapp_sistema")
      .order("enviado_em", { ascending: false })
      .limit(20);
    // Tabela ainda sem migração (front publicado antes): a trava não existe, o envio segue.
    if (!erroAnteriores && envioRepetido(anteriores ?? [], { documentoId: linha ? linha.id : null, conversaId }, agora)) {
      throw new Error("Este documento acabou de ser enviado a esta conversa. Se precisa mandar de novo, espere 2 minutos e gere o PDF outra vez.");
    }
  }

  // 8. O que o cliente lê.
  const legenda = legendaDoDocumento({ tipo, numero: ref.numero, titulo: ref.titulo, link });
  const nomeArquivo = linha ? nomeDoArquivo(tipo, ref.numero) : null;

  // 9. A mensagem na fila.
  let filaId: string;
  let mensagemId: string;
  if (linha && nomeArquivo) {
    // O arquivo é SEMPRE o da linha conferida, nunca um caminho vindo da tela.
    const { data: arquivo, error: erroBaixa } = await admin.storage.from("documentos-pdf").download(linha.caminho);
    if (erroBaixa || !arquivo) throw new Error(erroBaixa?.message || "Não consegui ler o PDF gerado.");
    const destino = `caixa/${conversaId}/${Date.now()}-${nomeArquivo}`;
    const { error: erroSobe } = await admin.storage
      .from("whatsapp-midias")
      .upload(destino, arquivo, { contentType: "application/pdf", upsert: false });
    if (erroSobe) throw new Error(erroSobe.message);

    const { data: r, error } = await admin.rpc("whatsapp_responder_arquivo", {
      p_conversa_id: conversaId,
      p_usuario: dep.usuarioId,
      p_tipo: "documento",
      p_storage_path: destino,
      p_nome_arquivo: nomeArquivo,
      p_legenda: legenda,
    });
    if (error || !r?.fila_id) {
      // Recusou (por exemplo, a conexão caiu entre a conferência e agora): sem cópia órfã.
      await admin.storage.from("whatsapp-midias").remove([destino]);
      throw new Error(error?.message || "O banco não devolveu a fila do envio.");
    }
    filaId = String(r.fila_id);
    mensagemId = String(r.mensagem_id);
  } else {
    const { enfileirarMensagem } = await import("./whatsapp-fila.server");
    filaId = await enfileirarMensagem(admin, { conversaId, usuarioId: dep.usuarioId, texto: legenda, origem: "orcamento" });
    const fila = await lerUma(admin.from("whatsapp_fila_envio").select("id, mensagem_id").eq("id", filaId).maybeSingle());
    if (!fila?.mensagem_id) throw new Error("A mensagem entrou na fila, mas o banco não devolveu o id dela.");
    mensagemId = String(fila.mensagem_id);
  }

  // 10. O registro (documentos_enviados, evento, status e enviado_em do orçamento, chave no payload).
  //     A mensagem já vai sair: falhar aqui não desfaz nada, a tela avisa.
  //     Tenta duas vezes (timeout do banco passa). Se continuar falhando, devolve ok:false: a tela avisa e,
  //     quando a mensagem sair, `confirmarEnvioDoDocumento` ainda passa o orçamento a enviado.
  let registro: RegistroDoEnvio = { ok: false, motivo: "O registro não foi tentado." };
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const { data: reg, error: erroReg } = await admin.rpc("registrar_envio_documento", {
        p_usuario: dep.usuarioId,
        p_tipo: tipo,
        p_referencia_id: referenciaId,
        p_canal: "whatsapp_sistema",
        p_documento_id: linha ? linha.id : null,
        p_mensagem_id: mensagemId,
        p_conversa_id: conversaId,
      });
      if (erroReg) throw new Error(erroReg.message);
      registro = { ok: true, ...lerRegistro(reg) };
      break;
    } catch (e) {
      registro = { ok: false, motivo: e instanceof Error ? e.message : String(e) };
    }
  }

  // 11. O Pix do sinal, depois do orçamento, idêntico a antes, mas só em rascunho ou enviado e uma vez por 24 horas. Acessório: se falhar, o orçamento já saiu.
  let pix: ResultadoDoEnvioDoDocumento["pix"] = null;
  if (tipo === "orcamento" && ref.orc) {
    const vez = pixDoSinalPodeSair({
      status: (ref.orc as { status?: string | null }).status,
      condicao: ref.orc.condicao_pagamento,
      agora,
    });
    if (!vez.pode) {
      pix = { enviado: false, valor: 0, motivo: vez.motivo };
    } else {
      try {
        const { enviarPixDoSinal } = await import("./orcamento-whatsapp.functions");
        pix = await enviarPixDoSinal(admin, ref.orc, conversaId, ref.nome, dep.usuarioId);
      } catch (e) {
        pix = { enviado: false, valor: 0, motivo: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return { conversaId, mensagemId, filaId, comPdf: !!linha, nomeArquivo, link, pix, registro };
}

function lerRegistro(reg: unknown): { envioId: string; statusMudou: boolean; enviadoEmGravado: boolean } {
  const r = (reg ?? {}) as { envio_id?: unknown; status_mudou?: unknown; enviado_em_gravado?: unknown };
  if (typeof r.envio_id !== "string" || !r.envio_id) throw new Error("O banco não devolveu o registro do envio.");
  return { envioId: r.envio_id, statusMudou: r.status_mudou === true, enviadoEmGravado: r.enviado_em_gravado === true };
}

export const enviarDocumentoAoCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pedidoDeEnvioSchema.parse(d))
  .handler(async ({ data, context }): Promise<ResultadoDoEnvioDoDocumento> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return executarEnvioDoDocumento(
      { usuario: context.supabase, admin: supabaseAdmin, usuarioId: context.userId },
      data,
    );
  });

/**
 * wa.me ("WhatsApp") e "Link do cliente": registro de INTENÇÃO (canal `wa_me` ou `link_copiado`),
 * não prova de envio. No wa.me o servidor também passa rascunho a enviado e grava `enviado_em` quando
 * ainda é nulo (a tela deixa de escrever esse campo nesse caminho). Só orçamento.
 */
export const registroPorForaSchema = z.object({
  tipo: z.literal("orcamento"),
  referenciaId: z.string().uuid(),
  canal: z.enum(["wa_me", "link_copiado"]),
});

export type PedidoDeRegistroPorFora = z.infer<typeof registroPorForaSchema>;

export type ResultadoDoRegistroPorFora = { envioId: string; statusMudou: boolean; enviadoEmGravado: boolean };

export async function executarRegistroPorFora(
  dep: DependenciasDoEnvio,
  pedido: PedidoDeRegistroPorFora,
): Promise<ResultadoDoRegistroPorFora> {
  const tem = await permissoesDe(dep, PERMISSOES_PARA_REGISTRAR_POR_FORA);
  const permissao = podeRegistrarPorFora(tem);
  if (!permissao.pode) throw new Error(permissao.motivo);
  const { data, error } = await dep.admin.rpc("registrar_envio_documento", {
    p_usuario: dep.usuarioId,
    p_tipo: pedido.tipo,
    p_referencia_id: pedido.referenciaId,
    p_canal: pedido.canal,
  });
  if (error) throw new Error(error.message);
  return lerRegistro(data);
}

export const registrarEnvioPorFora = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => registroPorForaSchema.parse(d))
  .handler(async ({ data, context }): Promise<ResultadoDoRegistroPorFora> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return executarRegistroPorFora(
      { usuario: context.supabase, admin: supabaseAdmin, usuarioId: context.userId },
      data,
    );
  });


/**
 * Depois que a mensagem SAIU (a tela viu o desfecho "saiu"), o orçamento passa de rascunho a enviado e
 * ganha enviado_em, e o evento "enviado" é gravado. O banco confere a situação da mensagem
 * (`confirmar_envio_documento`). Se a função falhar (registro que não gravou, ou front publicado antes da
 * migração), o servidor faz o mínimo: status e enviado_em, só em rascunho ou enviado, só depois de
 * conferir que a mensagem é sua e saiu.
 */
export const confirmacaoSchema = z.object({
  tipo: z.enum(["orcamento", "os", "orcamento_3d"]),
  referenciaId: z.string().uuid(),
  mensagemId: z.string().uuid(),
});

export type PedidoDeConfirmacao = z.infer<typeof confirmacaoSchema>;

export type ResultadoDaConfirmacao =
  | { ok: true; statusMudou: boolean; enviadoEmGravado: boolean; pelaContingencia: boolean }
  | { ok: false; motivo: string };

const SAIU = ["enviada", "entregue", "lida"];

export async function executarConfirmacaoDoEnvio(
  dep: DependenciasDoEnvio,
  pedido: PedidoDeConfirmacao,
): Promise<ResultadoDaConfirmacao> {
  const admin = dep.admin;
  const tem = await permissoesDe(dep, PERMISSOES_PARA_ENVIAR[pedido.tipo]);
  const permissao = podeEnviarDocumento(pedido.tipo, tem);
  if (!permissao.pode) throw new Error(permissao.motivo);

  const msg = await lerUma(
    admin
      .from("whatsapp_mensagens")
      .select("id, status, enviada_por, direcao")
      .eq("id", pedido.mensagemId)
      .maybeSingle(),
  );
  if (!msg || msg.enviada_por !== dep.usuarioId || String(msg.direcao) !== "saida") {
    return { ok: false, motivo: "Esta mensagem não é um envio seu." };
  }
  if (!SAIU.includes(String(msg.status))) return { ok: false, motivo: "A mensagem ainda não saiu pelo WhatsApp." };

  const envio = await lerUma(
    admin
      .from("documentos_enviados")
      .select("id")
      .eq("mensagem_id", pedido.mensagemId)
      .eq("tipo", pedido.tipo)
      .eq("referencia_id", pedido.referenciaId)
      .maybeSingle(),
  ).catch(() => null);

  if (envio?.id) {
    const { data, error } = await admin.rpc("confirmar_envio_documento", { p_usuario: dep.usuarioId, p_envio_id: envio.id });
    if (!error) {
      const r = (data ?? {}) as { status_mudou?: unknown; enviado_em_gravado?: unknown };
      return {
        ok: true,
        statusMudou: r.status_mudou === true,
        enviadoEmGravado: r.enviado_em_gravado === true,
        pelaContingencia: false,
      };
    }
  }

  // Contingência: só o orçamento tem status e enviado_em.
  if (pedido.tipo !== "orcamento") return { ok: false, motivo: "O registro do envio não foi confirmado." };
  const orc = await lerUma(admin.from("orcamentos").select("id, status, enviado_em").eq("id", pedido.referenciaId).maybeSingle());
  if (!orc) return { ok: false, motivo: "Documento não encontrado." };
  const agora = (dep.agora?.() ?? new Date()).toISOString();
  if (orc.status === "rascunho") {
    const { error } = await admin
      .from("orcamentos")
      .update({ status: "enviado", enviado_em: orc.enviado_em ?? agora })
      .eq("id", orc.id)
      .eq("status", "rascunho");
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, statusMudou: true, enviadoEmGravado: !orc.enviado_em, pelaContingencia: true };
  }
  if (orc.status === "enviado" && !orc.enviado_em) {
    const { error } = await admin.from("orcamentos").update({ enviado_em: agora }).eq("id", orc.id).is("enviado_em", null);
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, statusMudou: false, enviadoEmGravado: true, pelaContingencia: true };
  }
  return { ok: true, statusMudou: false, enviadoEmGravado: false, pelaContingencia: true };
}

export const confirmarEnvioDoDocumento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => confirmacaoSchema.parse(d))
  .handler(async ({ data, context }): Promise<ResultadoDaConfirmacao> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return executarConfirmacaoDoEnvio(
      { usuario: context.supabase, admin: supabaseAdmin, usuarioId: context.userId },
      data,
    );
  });
