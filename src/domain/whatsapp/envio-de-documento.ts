import type { RespostaDoConsumidor } from "@/domain/whatsapp/caixa-de-entrada";

/**
 * O PDF do orçamento, da OS ou do orçamento 3D na conversa do cliente (onda "PDF ao cliente",
 * 12/11/2026). Regras puras, sem banco: a MESMA regra vale na tela (botão ligado ou não) e no
 * servidor (`src/lib/api/documento-whatsapp.functions.ts`), para o botão nunca aparecer para quem o
 * servidor recusa.
 *
 * O que mora aqui: quem pode mandar cada tipo, a conferência da linha de `documentos_gerados`
 * (só a via do cliente, do mesmo documento, gerada por quem manda, há menos de 15 minutos), o nome
 * do arquivo, a legenda que o cliente lê (sem travessão nem seta), a escolha da instância do
 * WhatsApp e o desfecho daquela linha da fila.
 */

export type TipoDeDocumento = "orcamento" | "os" | "orcamento_3d";

export const TIPOS_DE_DOCUMENTO: readonly TipoDeDocumento[] = ["orcamento", "os", "orcamento_3d"];

/** De onde o documento chegou ao cliente (CHECK de `documentos_enviados.canal`). */
export type CanalDoEnvio = "whatsapp_sistema" | "whatsapp_celular" | "wa_me" | "link_copiado" | "balcao";

export const CANAIS_DO_ENVIO: readonly CanalDoEnvio[] = [
  "whatsapp_sistema",
  "whatsapp_celular",
  "wa_me",
  "link_copiado",
  "balcao",
];

/** Canais que só registram a INTENÇÃO: quem clicou, não a prova de que a mensagem saiu. */
export const CANAIS_DE_INTENCAO: readonly CanalDoEnvio[] = ["wa_me", "link_copiado"];

/** A linha de `documentos_gerados` vale para o envio por 15 minutos depois de gerada. */
export const VALIDADE_DO_DOCUMENTO_MS = 15 * 60 * 1000;

/** Tolerância para relógio adiantado do banco em relação ao servidor. */
export const FOLGA_DO_RELOGIO_MS = 60 * 1000;

/**
 * Quem pode mandar cada tipo. `todas`: precisa de todas; `algumaDe`: precisa de pelo menos uma
 * (vazia = nada a exigir). A OS vai com valores (via do cliente): só quem vê preço, a mesma regra de
 * `canSeePrices` em `src/lib/auth-context.tsx` (financeiro.read ou precos.read).
 */
export type RegraDePermissao = { todas: readonly string[]; algumaDe: readonly string[] };

export const PERMISSOES_PARA_ENVIAR: Record<TipoDeDocumento, RegraDePermissao> = {
  // `orcamentos.create` em todos: o PDF é gerado no navegador e gravado com a sessão de quem clica, e as
  // policies de documentos_gerados e do bucket documentos-pdf exigem essa chave. Sem ela o botão apareceria
  // ligado e o upload falharia com erro cru de RLS.
  orcamento: { todas: ["whatsapp.reply", "orcamentos.send", "orcamentos.create"], algumaDe: [] },
  os: { todas: ["whatsapp.reply", "os.read", "orcamentos.create"], algumaDe: ["precos.read", "financeiro.read"] },
  orcamento_3d: { todas: ["whatsapp.reply", "impressao3d.quote.update", "orcamentos.create"], algumaDe: [] },
};

/** wa.me e "Link do cliente" (só orçamento): a mesma chave que gera o link. */
export const PERMISSOES_PARA_REGISTRAR_POR_FORA: RegraDePermissao = { todas: ["orcamentos.send"], algumaDe: [] };

export type ResultadoDaPermissao = { pode: true } | { pode: false; motivo: string };

/** Todas as chaves que o servidor precisa perguntar a `has_permission` para decidir o tipo. */
export function chavesParaConferir(regra: RegraDePermissao): string[] {
  return [...new Set([...regra.todas, ...regra.algumaDe])];
}

/** "orcamentos.send" vira "orcamentos › send", como a tela de permissões mostra. */
const chaveLegivel = (chave: string) => chave.replace(".", " › ");

const DOCUMENTO_DO_TIPO: Record<TipoDeDocumento, string> = {
  orcamento: "o orçamento",
  os: "a ordem de serviço",
  orcamento_3d: "o orçamento 3D",
};

function aplicarRegra(
  regra: RegraDePermissao,
  tem: (permissao: string) => boolean,
  oQue: string,
  semNenhumaDe: string,
): ResultadoDaPermissao {
  const falta = regra.todas.find((p) => !tem(p));
  if (falta) {
    return { pode: false, motivo: `Seu perfil não pode mandar ${oQue} ao cliente: falta a permissão ${chaveLegivel(falta)}.` };
  }
  if (regra.algumaDe.length > 0 && !regra.algumaDe.some((p) => tem(p))) {
    return { pode: false, motivo: semNenhumaDe };
  }
  return { pode: true };
}

/** Decide pela regra do tipo. `tem` é `hasPermission` na tela e o resultado de `has_permission` no servidor. */
export function podeEnviarDocumento(tipo: TipoDeDocumento, tem: (permissao: string) => boolean): ResultadoDaPermissao {
  return aplicarRegra(
    PERMISSOES_PARA_ENVIAR[tipo],
    tem,
    DOCUMENTO_DO_TIPO[tipo],
    "Só quem vê o preço da OS manda a via do cliente.",
  );
}

/** wa.me e link copiado do orçamento. */
export function podeRegistrarPorFora(tem: (permissao: string) => boolean): ResultadoDaPermissao {
  return aplicarRegra(PERMISSOES_PARA_REGISTRAR_POR_FORA, tem, "o orçamento", "Seu perfil não pode mandar o orçamento ao cliente.");
}

/** A linha de `documentos_gerados` como o servidor lê (chave de serviço). */
export type LinhaDoDocumentoGerado = {
  id: string;
  tipo: string;
  referencia_id: string;
  variante: string;
  caminho: string;
  gerado_por: string | null;
  created_at: string;
};

export type PedidoDeConferencia = { tipo: TipoDeDocumento; referenciaId: string; usuarioId: string };

export type Conferencia = { ok: true } | { ok: false; motivo: string };

/**
 * Só serve a via do CLIENTE deste mesmo documento, gerada por quem está mandando, há menos de
 * `VALIDADE_DO_DOCUMENTO_MS`, com o caminho na pasta `{tipo}/{referenciaId}/` e terminado em `.pdf`.
 * Fecha o buraco de antes: o servidor aceitava qualquer arquivo com o prefixo do orçamento, e a via
 * de produção (ou de custos) poderia sair ao cliente.
 */
export function documentoServeParaEnvio(
  linha: LinhaDoDocumentoGerado | null,
  pedido: PedidoDeConferencia,
  agora: Date,
): Conferencia {
  if (!linha) return { ok: false, motivo: "O PDF gerado não foi encontrado. Gere de novo." };
  if (linha.tipo !== pedido.tipo || linha.referencia_id !== pedido.referenciaId) {
    return { ok: false, motivo: "Este PDF é de outro documento." };
  }
  if (linha.variante !== "cliente") return { ok: false, motivo: "Só a via do cliente vai ao cliente." };
  if (!linha.gerado_por || linha.gerado_por !== pedido.usuarioId) {
    return { ok: false, motivo: "Este PDF foi gerado por outra pessoa. Gere de novo." };
  }
  const criado = new Date(linha.created_at).getTime();
  const idade = agora.getTime() - criado;
  if (!Number.isFinite(criado) || idade >= VALIDADE_DO_DOCUMENTO_MS || idade < -FOLGA_DO_RELOGIO_MS) {
    return { ok: false, motivo: "Este PDF foi gerado há mais de 15 minutos. Gere de novo." };
  }
  const pasta = `${pedido.tipo}/${pedido.referenciaId}/`;
  const caminho = String(linha.caminho ?? "");
  if (!caminho.startsWith(pasta) || caminho.includes("..") || !caminho.toLowerCase().endsWith(".pdf")) {
    return { ok: false, motivo: "O arquivo deste PDF não está na pasta do documento. Gere de novo." };
  }
  return { ok: true };
}

/** O dono e a data do objeto no Storage (`arquivo_do_pdf_gerado`): o navegador não escolhe nenhum dos dois. */
export type ObjetoDoStorage = { owner_id: string | null; created_at: string | null } | null;

/**
 * A linha de `documentos_gerados` é escrita pelo navegador (a policy "docs insert" só pede
 * orcamentos.create), então variante, gerado_por e created_at podem ser forjados. O servidor confere
 * também o OBJETO: do Storage vêm o dono e a hora, e o nome do arquivo tem de ter o formato que
 * `salvarERegistrarPDF` dá à via do cliente: `{agora}-{tipo}-{numero}.pdf`, sem `-producao` nem `-custos`.
 */
export function objetoServeParaEnvio(
  caminho: string,
  pedido: PedidoDeConferencia,
  objeto: ObjetoDoStorage,
  agora: Date,
): Conferencia {
  const nome = caminho.slice(`${pedido.tipo}/${pedido.referenciaId}/`.length);
  if (!new RegExp(`^\\d{10,}-${pedido.tipo}-[0-9A-Za-z]+\\.pdf$`).test(nome)) {
    return { ok: false, motivo: "O nome deste arquivo não é o de uma via do cliente. Gere de novo." };
  }
  if (!objeto || !objeto.owner_id || !objeto.created_at) {
    return { ok: false, motivo: "O arquivo do PDF não está no Storage. Gere de novo." };
  }
  if (objeto.owner_id !== pedido.usuarioId) {
    return { ok: false, motivo: "Este PDF foi enviado ao Storage por outra pessoa. Gere de novo." };
  }
  const idade = agora.getTime() - new Date(objeto.created_at).getTime();
  if (!Number.isFinite(idade) || idade >= VALIDADE_DO_DOCUMENTO_MS || idade < -FOLGA_DO_RELOGIO_MS) {
    return { ok: false, motivo: "Este PDF foi gerado há mais de 15 minutos. Gere de novo." };
  }
  return { ok: true };
}

/** O Pix do sinal não se repete: nem fora de rascunho ou enviado, nem se já foi pedido há menos de 24 horas. */
export const JANELA_DO_PIX_MS = 24 * 60 * 60 * 1000;

export function pixDoSinalPodeSair(a: {
  status: string | null | undefined;
  condicao: unknown;
  agora: Date;
}): { pode: true } | { pode: false; motivo: string } {
  if (a.status !== "rascunho" && a.status !== "enviado") {
    return { pode: false, motivo: `orçamento ${a.status ?? "sem status"}: o sinal não é pedido de novo` };
  }
  const antes = (a.condicao as { pix_enviado?: { em?: unknown } } | null)?.pix_enviado?.em;
  const quando = typeof antes === "string" ? new Date(antes).getTime() : NaN;
  if (Number.isFinite(quando) && a.agora.getTime() - quando < JANELA_DO_PIX_MS) {
    return { pode: false, motivo: "o Pix do sinal já foi pedido nas últimas 24 horas" };
  }
  return { pode: true };
}

/** Mesmo PDF ou mesmo documento na mesma conversa em menos de 2 minutos: provável clique duplo. */
export const JANELA_DO_ENVIO_REPETIDO_MS = 2 * 60 * 1000;

export function envioRepetido(
  anteriores: readonly { documento_id: string | null; conversa_id: string | null; enviado_em: string }[],
  este: { documentoId: string | null; conversaId: string | null },
  agora: Date,
): boolean {
  return anteriores.some((e) => {
    if (este.documentoId && e.documento_id === este.documentoId) return true;
    const idade = agora.getTime() - new Date(e.enviado_em).getTime();
    return e.conversa_id === este.conversaId && idade >= 0 && idade < JANELA_DO_ENVIO_REPETIDO_MS;
  });
}

const numeroLimpo = (numero: number | string) => String(numero).trim().replace(/[^0-9A-Za-z]+/g, "-");

/**
 * "orcamento-123.pdf" (o nome que o envio do orçamento sempre usou e que a caixa de entrada já tem),
 * "OS-456.pdf", "Orcamento-3D-123.pdf" (sem acento: atrapalha no WhatsApp).
 */
export function nomeDoArquivo(tipo: TipoDeDocumento, numero: number | string): string {
  const prefixo = tipo === "orcamento" ? "orcamento" : tipo === "os" ? "OS" : "Orcamento-3D";
  return `${prefixo}-${numeroLimpo(numero)}.pdf`;
}

/** "o orçamento nº 123", "a ordem de serviço nº 456", "o orçamento 3D nº 123". */
export function nomeDoDocumento(tipo: TipoDeDocumento, numero: number | string): string {
  return `${DOCUMENTO_DO_TIPO[tipo]} nº ${String(numero).trim()}`;
}

/** "do orçamento nº 123", "da ordem de serviço nº 456". */
const doDocumento = (tipo: TipoDeDocumento, numero: number | string) =>
  nomeDoDocumento(tipo, numero).replace(/^o /, "do ").replace(/^a /, "da ");

/** Tira travessão (— –) e seta (→ ← ⇒ ➜ ➔) de um texto que o cliente vai ler; espaço duplo vira um. */
export function textoAoCliente(texto: string): string {
  return texto
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[→←⇒➜➔]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +,/g, ",")
    .trim();
}

/**
 * A legenda do PDF (e, sem PDF, o texto) que o cliente lê. Orçamento:
 *   "Olá! Segue o orçamento nº 123: Banner da fachada.\nVocê pode conferir e aprovar por aqui: <link>"
 * OS: "Olá! Segue a ordem de serviço nº 456: Banner da fachada."
 * 3D: "Olá! Segue o orçamento 3D nº 123: Chaveiro."
 * O começo "Olá! Segue o orçamento nº" NÃO muda: a cobrança no grupo lê essa frase nas mensagens
 * antigas. Título vazio: "Olá! Segue o orçamento nº 123." Ponto final do título não dobra.
 */
export function legendaDoDocumento(a: {
  tipo: TipoDeDocumento;
  numero: number | string;
  titulo: string | null;
  /** Só orçamento: o link de aprovação. */
  link?: string | null;
}): string {
  const titulo = textoAoCliente(a.titulo ?? "")
    .replace(/[\s.!?,;:]+$/, "")
    .replace(/^[\s,;:]+/, "");
  const primeira = `Olá! Segue ${nomeDoDocumento(a.tipo, a.numero)}${titulo ? `: ${titulo}` : ""}.`;
  const link = (a.link ?? "").trim();
  if (a.tipo === "orcamento" && link) return `${primeira}\nVocê pode conferir e aprovar por aqui: ${link}`;
  return primeira;
}

/** Para quem vai: o telefone do próprio documento, o do orçamento de origem, o do cadastro (WhatsApp e depois telefone). */
export function telefoneDoEnvio(a: {
  doDocumento?: string | null;
  doOrcamento?: string | null;
  doCliente?: { whatsapp_principal?: string | null; telefone?: string | null } | null;
}): string | null {
  for (const v of [a.doDocumento, a.doOrcamento, a.doCliente?.whatsapp_principal, a.doCliente?.telefone]) {
    const t = String(v ?? "").trim();
    if (t) return t;
  }
  return null;
}

export type InstanciaParaEnvio = {
  id?: string;
  ativa: boolean | null;
  conectado: boolean | null;
  status: string | null;
  created_at?: string | null;
};

/**
 * A instância que uma conversa NOVA usaria: a mesma escolha de `whatsapp_conversa_do_numero`
 * (ativa, conectada primeiro, a mais antiga).
 */
export function instanciaDoEnvio<T extends InstanciaParaEnvio>(instancias: readonly T[]): T | null {
  const ativas = instancias.filter((i) => i.ativa === true);
  const quando = (i: T) => {
    const t = i.created_at ? new Date(i.created_at).getTime() : Number.POSITIVE_INFINITY;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const ordenadas = [...ativas].sort((x, y) => {
    const cx = x.conectado === true ? 0 : 1;
    const cy = y.conectado === true ? 0 : 1;
    if (cx !== cy) return cx - cy;
    return quando(x) - quando(y);
  });
  return ordenadas[0] ?? null;
}

/** A mesma regra de `whatsapp_responder_arquivo`: ativa, conectado e status 'conectada'. */
export function instanciaConectada(instancia: InstanciaParaEnvio | null | undefined): boolean {
  return !!instancia && instancia.ativa === true && instancia.conectado === true && instancia.status === "conectada";
}

/** Recusa do servidor com o WhatsApp desconectado (nada foi copiado nem enfileirado). */
export const MOTIVO_DESCONECTADO =
  "O WhatsApp da gráfica está desconectado. Reconecte o WhatsApp no Monitor. Nada foi enviado.";

/** O que `acionarEnvio()` devolve (src/components/whatsapp/usar-caixa-de-entrada.ts). */
export type RespostaDoAcionamento =
  | { status: number; corpo: RespostaDoConsumidor | null }
  | { falhaDeRede: string };

export type SituacaoDoEnvio = "saiu" | "na_fila" | "nao_saiu";

export type DesfechoDoDocumento = {
  situacao: SituacaoDoEnvio;
  tom: "sucesso" | "aviso" | "erro";
  texto: string;
};

const semPontoFinal = (t: string) => textoAoCliente(t).replace(/[\s.]+$/, "");

/**
 * O que a tela diz depois de acionar o despachante, olhando AQUELA linha da fila (`filaId`), como o
 * painel da conversa já fazia. 200 do despachante não basta. Sem travessão no texto.
 */
export function desfechoDoEnvioDoDocumento(
  http: RespostaDoAcionamento,
  filaId: string,
  documento: { tipo: TipoDeDocumento; numero: number | string; comPdf: boolean },
): DesfechoDoDocumento {
  const oQue = `${documento.comPdf ? "O PDF" : "O link"} ${doDocumento(documento.tipo, documento.numero)}`;
  if ("falhaDeRede" in http) {
    return {
      situacao: "na_fila",
      tom: "aviso",
      texto: `${oQue} está na fila e ainda não saiu: o envio não foi acionado (${semPontoFinal(http.falhaDeRede)}). Use Tentar de novo na mensagem, na conversa.`,
    };
  }
  const corpo = http.corpo ?? {};
  const minha = (corpo.resultados ?? []).find((r) => r.fila_id === filaId);
  if (minha?.situacao === "enviada") {
    const gravacao = (corpo.erros_de_gravacao ?? []).find(
      (e) => e.id === filaId || (minha.mensagem_id != null && e.id === minha.mensagem_id),
    );
    if (gravacao) {
      return {
        situacao: "saiu",
        tom: "aviso",
        texto: `${oQue} saiu pelo WhatsApp, mas o sistema não conseguiu registrar: ${semPontoFinal(gravacao.erro)}.`,
      };
    }
    return { situacao: "saiu", tom: "sucesso", texto: `${oQue} saiu pelo WhatsApp da gráfica.` };
  }
  if (minha?.situacao === "falha") {
    return {
      situacao: "nao_saiu",
      tom: "erro",
      texto: `${oQue} não saiu: ${minha.erro ? semPontoFinal(minha.erro) : "o WhatsApp recusou"}.`,
    };
  }
  if (minha?.situacao === "pendente") {
    return {
      situacao: "na_fila",
      tom: "aviso",
      texto: `${oQue} está na fila e ainda não saiu: ${minha.erro ? semPontoFinal(minha.erro) : "o envio vai ser tentado de novo"}.`,
    };
  }
  if (http.status < 200 || http.status >= 300) {
    const passo = corpo.comoResolver ? ` ${textoAoCliente(corpo.comoResolver)}` : "";
    return {
      situacao: "na_fila",
      tom: "aviso",
      texto: `${oQue} está na fila e ainda não saiu: ${corpo.erro ? semPontoFinal(corpo.erro) : `o envio respondeu ${http.status}`}.${passo}`,
    };
  }
  return {
    situacao: "na_fila",
    tom: "aviso",
    texto: `${oQue} está na fila: outra rodada de envio pode estar com ele. O selo da mensagem na conversa muda quando sair.`,
  };
}
