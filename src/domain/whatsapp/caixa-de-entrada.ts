import { chaveWhatsApp, formatarTelefone } from "@/domain/documentos";
import { situacaoDaConexao, type InstanciaResumo } from "@/domain/whatsapp/situacao-conexao";
import type { StatusMensagem } from "@/domain/whatsapp/status-das-filas";

/**
 * A caixa de entrada do WhatsApp (/whatsapp), em regras puras.
 *
 * A tela antiga era demonstração: cinco conversas e cinco mensagens fixas no
 * código ("Marcos Silva", "Padaria Aurora"), sete botões sem ação e um
 * "Concluir atendimento" que só mudava o estado da tela. Esta caixa lê o que o
 * webhook grava — `whatsapp_registrar_mensagem` escreve `whatsapp_conversas`
 * (ultima_mensagem, ultima_mensagem_at, nao_lidas, status) e
 * `whatsapp_mensagens` (direcao, texto, legenda, recebido_em…) — e responde
 * pelo caminho de envio que já existia: `whatsapp_fila_envio` + POST
 * /api/whatsapp/enviar.
 *
 * Duas colunas de `whatsapp_conversas` parecem servir e NÃO servem:
 * `unread_count` (o webhook incrementa `nao_lidas`, nunca ela) e
 * `atribuido_para` (os relatórios de atendimento leem `responsavel_id`).
 */

export type StatusConversa = "aberta" | "pendente" | "resolvida" | "arquivada";

export type ConversaDaCaixa = {
  id: string;
  instancia_id: string;
  telefone: string;
  nome_contato: string | null;
  cliente_id: string | null;
  lead_id: string | null;
  os_id: string | null;
  status: StatusConversa;
  etiquetas: string[] | null;
  ultima_mensagem: string | null;
  ultima_mensagem_at: string | null;
  nao_lidas: number | null;
  responsavel_id: string | null;
  created_at: string;
  cliente?: { id: string; nome: string } | null;
  lead?: { id: string; nome: string | null; status: string | null } | null;
};

export type MensagemDaCaixa = {
  id: string;
  direcao: "entrada" | "saida";
  tipo: string;
  status: StatusMensagem | string;
  texto: string | null;
  legenda: string | null;
  media_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  erro: string | null;
  recebido_em: string | null;
  enviado_em: string | null;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Responder: liberado ou não, e por quê                               */
/* ------------------------------------------------------------------ */

export type Liberacao =
  | { liberado: true }
  | {
      liberado: false;
      /** O texto que vai NO BOTÃO desabilitado — a pessoa lê ali o motivo. */
      rotulo: string;
      /** O que fazer para destravar. */
      motivo: string;
    };

/**
 * O envio está liberado nesta instância?
 *
 * Espelha as recusas de `whatsapp_responder` no banco (instância ativa,
 * `conectado = true` e `status = 'conectada'`). As duas precisam concordar:
 * se a tela liberasse o que o banco recusa, o botão "enviaria" e voltaria com
 * erro; se recusasse o que o banco aceita, a resposta nunca sairia.
 *
 * "Conectada mas sem evento" LIBERA: o envio não depende do webhook, só a
 * recepção. Quem conserta a recepção é o Monitor.
 */
export function envioLiberado(instancia: InstanciaResumo | null): Liberacao {
  if (!instancia) {
    return {
      liberado: false,
      rotulo: "WhatsApp não configurado",
      motivo: "Cadastre a instância do Z-API no Monitor do WhatsApp.",
    };
  }
  if (instancia.ativa === false) {
    return {
      liberado: false,
      rotulo: "Instância do WhatsApp desativada",
      motivo: "A instância desta conversa foi desativada. Confira no Monitor do WhatsApp.",
    };
  }
  const conectada = instancia.conectado === true && instancia.status === "conectada";
  if (!conectada) {
    // Nunca recebeu evento: o celular nunca foi pareado. É a frase que o
    // dono pediu — e foi o estado real de 28/09 até 02/10/2026 às 16:30,
    // quando chegou o primeiro "Ao conectar" do Z-API.
    return instancia.ultimo_evento_at
      ? {
          liberado: false,
          rotulo: "WhatsApp desconectado — leia o QR Code de novo",
          motivo: PASSO_RELER_QR,
        }
      : {
          liberado: false,
          rotulo: "WhatsApp desconectado — falta escanear o QR Code",
          motivo: PASSO_ESCANEAR_QR,
        };
  }
  return { liberado: true };
}

// As frases de `situacaoDaConexao` dizem "clique em Verificar aqui" porque
// moram no cartão do Monitor. Na caixa de entrada o "aqui" é outra tela.
const PASSO_ESCANEAR_QR =
  "O celular da gráfica ainda não foi pareado. No painel do Z-API, escaneie o QR Code com o WhatsApp da empresa e depois clique em Verificar no Monitor do WhatsApp.";
const PASSO_RELER_QR =
  "O celular saiu do WhatsApp Web do Z-API. Leia o QR Code de novo no painel deles e clique em Verificar no Monitor do WhatsApp.";

/** Permissão primeiro: quem só lê não precisa saber do QR Code. */
export function podeResponder(instancia: InstanciaResumo | null, temPermissao: boolean): Liberacao {
  if (!temPermissao) {
    return {
      liberado: false,
      rotulo: "Seu perfil só lê as conversas",
      motivo: "Responder exige a permissão whatsapp › reply (vendedor ou administrador).",
    };
  }
  return envioLiberado(instancia);
}

/* ------------------------------------------------------------------ */
/* Caixa vazia: dizer o motivo                                         */
/* ------------------------------------------------------------------ */

export type Vazio = { titulo: string; detalhe: string };

/**
 * Por que a caixa está vazia. "Nenhuma conversa" sozinho leva a pessoa a achar
 * que ninguém escreveu — quando o motivo pode ser que o celular nunca foi
 * pareado e mensagem nenhuma consegue chegar (foi assim até 02/10/2026).
 */
export function vazioDaCaixa(instancia: InstanciaResumo | null): Vazio {
  // A classificação é a de `situacaoDaConexao` — a mesma do cartão do Monitor
  // e da faixa do topo. Só a frase muda, porque aqui a pessoa está na caixa.
  const { rotulo } = situacaoDaConexao(instancia);
  switch (rotulo) {
    case "Não configurado":
      return {
        titulo: "Nenhuma conversa ainda — o WhatsApp não está configurado",
        detalhe:
          "Cadastre a instância do Z-API no Monitor do WhatsApp e cole o endereço gerado no painel deles.",
      };
    case "Desativada":
      return {
        titulo: "Nenhuma conversa ainda — a instância do WhatsApp está desativada",
        detalhe: "Reative ou cadastre a instância no Monitor do WhatsApp.",
      };
    case "Falta escanear o QR Code":
      return {
        titulo: "Nenhuma conversa ainda — falta escanear o QR Code",
        detalhe: PASSO_ESCANEAR_QR,
      };
    case "Desconectada":
      return { titulo: "Nenhuma conversa — o WhatsApp está desconectado", detalhe: PASSO_RELER_QR };
    case "Aguardando o primeiro evento":
      return {
        titulo: "Nenhuma mensagem recebida ainda",
        detalhe:
          "O WhatsApp está conectado, mas o Z-API ainda não chamou o sistema. Confira no Monitor do WhatsApp se o endereço foi colado nos webhooks e mande uma mensagem de teste para o número da empresa.",
      };
    default:
      return {
        titulo: "Nenhuma mensagem recebida ainda",
        detalhe: "Quando um cliente escrever para o número da empresa, a conversa aparece aqui.",
      };
  }
}

/**
 * A instância que a caixa mostra no topo. Só para EXIBIR a situação — nada é
 * gravado com ela: a resposta usa a instância da própria conversa.
 */
export function instanciaPrincipal<T extends InstanciaResumo & { created_at?: string | null }>(
  instancias: T[],
): T | null {
  const ativas = instancias
    .filter((i) => i.ativa !== false)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return ativas[0] ?? instancias[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Lista de conversas                                                  */
/* ------------------------------------------------------------------ */

/** "5596981216527" → "(96) 98121-6527"; o que não for telefone brasileiro passa como veio. */
export function telefoneLegivel(telefone: string | null | undefined): string {
  const chave = chaveWhatsApp(telefone);
  if (chave && (chave.length === 10 || chave.length === 11)) return formatarTelefone(chave);
  return telefone ?? "";
}

/** Cliente vinculado > nome que o contato usa no WhatsApp > nome do lead > telefone. */
export function nomeDaConversa(c: ConversaDaCaixa): string {
  return (
    c.cliente?.nome?.trim() ||
    c.nome_contato?.trim() ||
    c.lead?.nome?.trim() ||
    telefoneLegivel(c.telefone) ||
    "Contato sem nome"
  );
}

export type Aba = "abertas" | "concluidas" | "todas";

export function estaAberta(c: Pick<ConversaDaCaixa, "status">): boolean {
  return c.status === "aberta" || c.status === "pendente";
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca por nome, telefone (com ou sem máscara), última mensagem, cliente e etiqueta. */
export function filtrarConversas<T extends ConversaDaCaixa>(
  conversas: T[],
  { busca, aba }: { busca: string; aba: Aba },
): T[] {
  const termo = semAcento(busca.trim());
  const digitos = busca.replace(/\D/g, "");
  return conversas.filter((c) => {
    if (aba === "abertas" && !estaAberta(c)) return false;
    if (aba === "concluidas" && estaAberta(c)) return false;
    if (!termo) return true;
    const texto = semAcento(
      [
        nomeDaConversa(c),
        c.nome_contato,
        c.cliente?.nome,
        c.ultima_mensagem,
        ...(c.etiquetas ?? []),
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (texto.includes(termo)) return true;
    // Telefone: "98121" acha "(96) 98121-6527" e "5596981216527".
    return digitos.length >= 3 && (c.telefone ?? "").replace(/\D/g, "").includes(digitos);
  });
}

export function contarPorAba(conversas: Pick<ConversaDaCaixa, "status">[]): Record<Aba, number> {
  const abertas = conversas.filter(estaAberta).length;
  return { abertas, concluidas: conversas.length - abertas, todas: conversas.length };
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

const ROTULO_TIPO: Record<string, string> = {
  imagem: "Imagem",
  documento: "Documento",
  audio: "Áudio",
  video: "Vídeo",
  sticker: "Figurinha",
  localizacao: "Localização",
  contato: "Contato",
  sistema: "Aviso do sistema",
};

export function rotuloDoTipo(tipo: string): string {
  return ROTULO_TIPO[tipo] ?? tipo;
}

/** O texto da bolha: mensagem, legenda da mídia, ou o tipo entre colchetes. */
export function conteudoDaMensagem(m: Pick<MensagemDaCaixa, "texto" | "legenda" | "tipo">): string {
  const texto = m.texto?.trim() || m.legenda?.trim();
  if (texto) return texto;
  return `[${rotuloDoTipo(m.tipo)}]`;
}

/** O momento que a pessoa viveu: quando chegou ou quando saiu, não quando o banco gravou. */
export function quandoFoi(
  m: Pick<MensagemDaCaixa, "recebido_em" | "enviado_em" | "created_at">,
): string {
  return m.recebido_em ?? m.enviado_em ?? m.created_at;
}

export type SeloDeStatus = { texto: string; tom: "cyan" | "magenta" | "lime" | "amber" | "muted" };

/**
 * O selo das mensagens que a EMPRESA mandou. "pendente" é "na fila" — a
 * mensagem foi aceita pelo sistema e ainda não saiu. Dizer "enviada" aqui
 * seria o botão que finge que fez.
 */
export function seloDoStatus(m: Pick<MensagemDaCaixa, "direcao" | "status">): SeloDeStatus | null {
  if (m.direcao !== "saida") return null;
  switch (m.status) {
    case "pendente":
      return { texto: "na fila — ainda não saiu", tom: "amber" };
    case "enviada":
      return { texto: "enviada", tom: "cyan" };
    case "entregue":
      return { texto: "entregue", tom: "cyan" };
    case "lida":
      return { texto: "lida", tom: "lime" };
    case "falha":
      return { texto: "não saiu", tom: "magenta" };
    default:
      return { texto: String(m.status), tom: "muted" };
  }
}

const FUSO = "America/Belem";

/** Hora curta para a lista: hoje → "14:32"; outro dia → "02/10". No fuso de Macapá. */
export function horaCurta(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dia = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: FUSO });
  if (dia(d) === dia(agora)) {
    return d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
}

/** "02/10 14:32", no fuso de Macapá. */
export function diaEHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const data = d.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} ${hora}`;
}

/* ------------------------------------------------------------------ */
/* Da conversa para o orçamento                                        */
/* ------------------------------------------------------------------ */

/**
 * O pedido do cliente, montado com as últimas mensagens DELE (não as nossas):
 * é o que vai para o orçamento novo. Cada linha leva dia e hora, porque "para
 * sexta" só faz sentido sabendo quando foi dito.
 */
export function pedidoDaConversa(mensagens: MensagemDaCaixa[], limite = 10): string {
  return mensagens
    .filter((m) => m.direcao === "entrada")
    .map((m) => ({
      quando: quandoFoi(m),
      texto: (m.texto ?? m.legenda ?? "").trim(),
      tipo: m.tipo,
    }))
    .filter((m) => m.texto || m.tipo !== "texto")
    .sort((a, b) => a.quando.localeCompare(b.quando))
    .slice(-limite)
    .map((m) => `[${diaEHora(m.quando)}] ${m.texto || `[${rotuloDoTipo(m.tipo)}]`}`)
    .join("\n");
}

export function tituloSugerido(c: ConversaDaCaixa): string {
  return `Pedido pelo WhatsApp — ${nomeDaConversa(c)}`.slice(0, 120);
}

/* ------------------------------------------------------------------ */
/* Etiquetas                                                           */
/* ------------------------------------------------------------------ */

/** As que a gráfica mais vai usar; qualquer outra pode ser digitada. */
export const ETIQUETAS_SUGERIDAS = [
  "Orçamento",
  "Arte",
  "Produção",
  "Pagamento",
  "Retirada",
  "Entrega",
];

export function normalizarEtiqueta(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, 30);
}

/** Acrescenta sem duplicar ("orçamento" e "Orçamento" são a mesma etiqueta). */
export function adicionarEtiqueta(lista: string[] | null | undefined, nova: string): string[] {
  const atual = lista ?? [];
  const limpa = normalizarEtiqueta(nova);
  if (!limpa) return atual;
  if (atual.some((e) => semAcento(e) === semAcento(limpa))) return atual;
  return [...atual, limpa];
}

export function removerEtiqueta(lista: string[] | null | undefined, alvo: string): string[] {
  return (lista ?? []).filter((e) => semAcento(e) !== semAcento(alvo));
}

/* ------------------------------------------------------------------ */
/* Resultado do envio                                                  */
/* ------------------------------------------------------------------ */

export type RespostaDoConsumidor = {
  ok?: boolean;
  erro?: string;
  comoResolver?: string;
  resultados?: {
    fila_id: string;
    mensagem_id: string | null;
    situacao: string;
    erro: string | null;
  }[];
  erros_de_gravacao?: { tabela: string; id: string; erro: string }[];
};

export type Desfecho = { tom: "sucesso" | "aviso" | "erro"; texto: string };

/**
 * O que dizer depois de chamar POST /api/whatsapp/enviar para a fila desta
 * resposta. A regra é uma só: "enviada" só quando o consumidor diz que ESTA
 * linha saiu. Resposta 200 não basta — o lote pode ter rodado sem chegar nela
 * (o consumidor pega 20 por vez, das mais antigas para as mais novas) ou o
 * despachante de outra aba pode ter reservado a linha um instante antes.
 */
export function desfechoDoEnvio(
  http: { status: number; corpo: RespostaDoConsumidor | null } | { falhaDeRede: string },
  filaId: string,
  mensagemId: string,
): Desfecho {
  if ("falhaDeRede" in http) {
    return {
      tom: "aviso",
      texto: `A resposta ficou na fila e ainda não saiu: o envio não foi acionado (${http.falhaDeRede}). Use "Tentar de novo" na mensagem.`,
    };
  }
  const corpo = http.corpo ?? {};
  const gravacao = (corpo.erros_de_gravacao ?? []).find(
    (e) => e.id === filaId || e.id === mensagemId,
  );
  const minha = (corpo.resultados ?? []).find((r) => r.fila_id === filaId);

  if (minha?.situacao === "enviada") {
    if (gravacao) {
      return {
        tom: "erro",
        texto: `A mensagem saiu pelo WhatsApp, mas o sistema não conseguiu registrar: ${gravacao.erro}`,
      };
    }
    return { tom: "sucesso", texto: "Mensagem enviada." };
  }
  if (minha?.situacao === "falha") {
    return { tom: "erro", texto: `A mensagem não saiu: ${minha.erro ?? "o Z-API recusou"}.` };
  }
  if (minha?.situacao === "pendente") {
    return {
      tom: "aviso",
      texto: `A mensagem ficou na fila e ainda não saiu: ${minha.erro ?? "o envio vai ser tentado de novo"}.`,
    };
  }
  if (http.status < 200 || http.status >= 300) {
    const passo = corpo.comoResolver ? ` ${corpo.comoResolver}` : "";
    return {
      tom: "aviso",
      texto: `A resposta ficou na fila e ainda não saiu: ${corpo.erro ?? `o envio respondeu ${http.status}`}.${passo}`,
    };
  }
  return {
    tom: "aviso",
    texto:
      "A resposta ficou na fila — outra rodada de envio pode estar com ela. O selo da mensagem muda quando ela sair.",
  };
}
