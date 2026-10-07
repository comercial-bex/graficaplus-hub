import { chaveWhatsApp } from "@/domain/documentos";

/**
 * O envio pelo Z-API.
 *
 * A entrada (receber mensagem) já existia e funciona. A saída não: a tabela
 * `whatsapp_fila_envio` existe desde junho, a tela de monitor enfileira nela —
 * e nada nunca consumiu essa fila. Mensagem enfileirada ficava lá para sempre.
 * É o elo morto clássico: a peça modelada que ninguém preenche, só que aqui é
 * a peça preenchida que ninguém lê.
 *
 * Este módulo é puro de propósito: monta o endereço e o corpo, e não fala com
 * a rede. O token não passa por aqui em lugar nenhum além do endereço montado
 * no servidor — nunca chega ao navegador.
 */

/** O que o Z-API aceita e o sistema usa. */
export type TipoEnvio = "texto" | "pdf" | "imagem";

export type PedidoDeEnvio = {
  tipo: TipoEnvio;
  /** Telefone do destinatário, em qualquer formatação. */
  para: string;
  /** Corpo da mensagem (texto) ou legenda (pdf). */
  texto?: string;
  /** URL pública do PDF, ou data URI. Só para tipo "pdf". */
  documento?: string;
  /** Nome do arquivo que o cliente vê. Só para tipo "pdf". */
  nomeArquivo?: string;
};

/**
 * O telefone como o Z-API quer: com o código do país.
 *
 * `chaveWhatsApp` TIRA o 55 — ela existe para reconhecer a mesma pessoa entre
 * cliente, lead e conversa, e para isso o 55 atrapalha. O Z-API quer o
 * contrário: 5596991112233. Trocar os dois faz toda mensagem falhar com
 * "número inválido", e é o tipo de erro que só aparece em produção.
 */
export function telefoneParaZapi(valor: string | null | undefined): string | null {
  const chave = chaveWhatsApp(valor);
  if (!chave || !/^[1-9][1-9]9[0-9]{8}$/.test(chave)) return null;
  return `55${chave}`;
}

export type EnderecoZapi = {
  url: string;
  corpo: Record<string, unknown>;
};

/**
 * Monta o endereço e o corpo da chamada.
 *
 * Devolve `null` quando o pedido não dá para enviar — destino inválido, texto
 * vazio, PDF sem documento. Recusar aqui é melhor que descobrir pelo 400 do
 * Z-API, que gasta uma tentativa e volta com mensagem em inglês.
 */
export function montarEnvio(
  pedido: PedidoDeEnvio,
  credenciais: { instanceId: string; token: string },
): EnderecoZapi | { erro: string } {
  const phone = telefoneParaZapi(pedido.para);
  if (!phone) {
    return { erro: `"${pedido.para ?? ""}" não é um celular que recebe WhatsApp` };
  }
  if (!credenciais.instanceId || !credenciais.token) {
    return { erro: "instância ou token do Z-API não configurados no servidor" };
  }

  const base = `https://api.z-api.io/instances/${credenciais.instanceId}/token/${credenciais.token}`;

  if (pedido.tipo === "texto") {
    const message = (pedido.texto ?? "").trim();
    if (!message) return { erro: "mensagem sem texto" };
    return { url: `${base}/send-text`, corpo: { phone, message } };
  }

  if (pedido.tipo === "imagem") {
    const image = (pedido.documento ?? "").trim();
    if (!image) return { erro: "envio de imagem sem o arquivo" };
    return {
      url: `${base}/send-image`,
      corpo: { phone, image, caption: (pedido.texto ?? "").trim() || undefined },
    };
  }

  const document = (pedido.documento ?? "").trim();
  if (!document) return { erro: "envio de PDF sem o arquivo" };
  return {
    url: `${base}/send-document/pdf`,
    corpo: {
      phone,
      document,
      fileName: (pedido.nomeArquivo ?? "documento.pdf").trim() || "documento.pdf",
      caption: (pedido.texto ?? "").trim() || undefined,
    },
  };
}

/**
 * O Z-API respondeu o quê?
 *
 * Sucesso vem com `messageId`. Erro vem com `error` ou `message`, e o HTTP nem
 * sempre é 4xx — por isso a checagem olha o corpo, não só o status.
 */
export function lerRespostaZapi(
  status: number,
  corpo: unknown,
): { ok: true; idExterno: string | null } | { ok: false; erro: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const idExterno =
    typeof c.messageId === "string" ? c.messageId : typeof c.id === "string" ? c.id : null;

  if (status >= 200 && status < 300 && idExterno) return { ok: true, idExterno };

  const erro =
    (typeof c.error === "string" && c.error) ||
    (typeof c.message === "string" && c.message) ||
    (status >= 200 && status < 300 ? "o Z-API respondeu sem messageId" : `HTTP ${status}`);
  return { ok: false, erro };
}

/**
 * Vale a pena tentar de novo?
 *
 * Número inválido e token errado não melhoram com repetição — insistir só
 * gasta a fila e esconde o motivo. Falha de rede e limite de taxa, sim.
 */
export function valeTentarDeNovo(erro: string): boolean {
  const e = erro.toLowerCase();
  if (/inválid|invalid|não é um celular|not exists|does not exist|unauthor|token/.test(e)) {
    return false;
  }
  return true;
}

/**
 * O texto do aviso, com as variáveis trocadas.
 *
 * Os seis modelos de `notificacao_templates` usam `{{cliente}}`,
 * `{{os_numero}}`, `{{os_titulo}}`, `{{prazo}}` e `{{orcamento_numero}}`. Eles
 * já existiam, bem escritos, desde agosto — o que nunca existiu foi quem
 * trocasse as chaves e mandasse.
 *
 * Variável ausente vira string vazia, e a frase é limpa em seguida: melhor uma
 * frase mais curta que um "{{prazo}}" cru chegando ao cliente.
 */
export function renderizarTemplate(
  corpo: string,
  variaveis: Record<string, unknown> | null | undefined,
): string {
  const v = variaveis ?? {};
  const trocado = corpo.replace(/\{\{\s*([a-z_0-9]+)\s*\}\}/gi, (_, chave: string) => {
    const valor = v[chave];
    if (valor === null || valor === undefined || valor === "") return "";
    return String(valor);
  });

  return trocado
    // "Previsão de entrega: ." quando o prazo não veio
    .replace(/:\s*\./g, ".")
    // parênteses que ficaram vazios: "pedido 12 ()"
    .replace(/\s*\(\s*\)/g, "")
    // espaço dobrado e espaço antes de pontuação
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Botões de resposta.
 *
 * O Bex Lite usa `send-button-list` para a aprovação de arte: o cliente toca
 * em "Aprovar" em vez de abrir um link, digitar e voltar. Numa gráfica isso é
 * a diferença entre aprovar no mesmo dia e esperar três.
 */
export type Botao = { id: string; rotulo: string };

export function montarBotoes(
  pedido: { para: string; texto: string; botoes: Botao[] },
  credenciais: { instanceId: string; token: string },
): EnderecoZapi | { erro: string } {
  const phone = telefoneParaZapi(pedido.para);
  if (!phone) return { erro: `"${pedido.para}" não é um celular que recebe WhatsApp` };
  if (!credenciais.instanceId || !credenciais.token) {
    return { erro: "instância ou token do Z-API não configurados no servidor" };
  }
  const message = (pedido.texto ?? "").trim();
  if (!message) return { erro: "mensagem sem texto" };
  // O Z-API aceita no máximo três botões; mandar mais faz a chamada inteira
  // falhar, então o corte é aqui e não lá.
  const botoes = (pedido.botoes ?? []).slice(0, 3);
  if (botoes.length === 0) return { erro: "nenhum botão informado" };

  return {
    url: `https://api.z-api.io/instances/${credenciais.instanceId}/token/${credenciais.token}/send-button-list`,
    corpo: {
      phone,
      message,
      buttonList: { buttons: botoes.map((b) => ({ id: b.id, label: b.rotulo.slice(0, 20) })) },
    },
  };
}
