/**
 * Em que pé está a conexão com o WhatsApp — em uma frase que diz o que fazer.
 *
 * O sinal que importa não é o status que a instância declara, é se o Z-API
 * está de fato chamando o nosso endereço. Uma instância "conectada" que nunca
 * mandou evento está com o webhook mal colado — e é esse o erro mais provável
 * no primeiro dia.
 */

export type InstanciaResumo = {
  conectado: boolean | null;
  status: string | null;
  ultimo_evento_at: string | null;
  ativa: boolean | null;
};

export type Situacao = {
  rotulo: string;
  tom: "lime" | "amber" | "magenta" | "muted";
  proximoPasso: string | null;
};

export function situacaoDaConexao(instancia: InstanciaResumo | null): Situacao {
  if (!instancia) {
    return {
      rotulo: "Não configurado",
      tom: "muted",
      proximoPasso: "Cadastre a instância do Z-API e cole o endereço gerado no painel deles.",
    };
  }
  if (instancia.ativa === false) {
    return { rotulo: "Desativada", tom: "muted", proximoPasso: null };
  }
  // Desconectada vem ANTES de "aguardando o primeiro evento". Na ordem antiga,
  // uma instância recém-cadastrada e nunca pareada caía em "aguardando" e o
  // cartão mandava conferir a URL do webhook — enquanto o passo real, o único
  // que destrava tudo, é escanear o QR Code. Foi assim em 28/09/2026: a
  // instância BEX PRINTS entrou desconectada, sem evento, e a tela escondia o
  // motivo.
  if (instancia.conectado === false || instancia.status === "desconectada") {
    // Nunca recebeu evento E está desconectada: o celular nunca foi pareado.
    // "Leia o QR de novo" seria a frase de quem caiu — aqui é a primeira vez.
    if (!instancia.ultimo_evento_at) {
      return {
        rotulo: "Falta escanear o QR Code",
        tom: "magenta",
        proximoPasso:
          "O celular da gráfica ainda não foi pareado. No painel do Z-API, abra a instância e escaneie o QR Code com o WhatsApp do celular da empresa; depois clique em Verificar aqui.",
      };
    }
    return {
      rotulo: "Desconectada",
      tom: "magenta",
      proximoPasso: "O celular saiu do WhatsApp Web do Z-API. Leia o QR Code de novo no painel deles.",
    };
  }
  if (!instancia.ultimo_evento_at) {
    return {
      rotulo: "Aguardando o primeiro evento",
      tom: "amber",
      proximoPasso:
        "O Z-API ainda não chamou este endereço. Confira se a URL foi colada nos webhooks e mande uma mensagem de teste para o número da empresa.",
    };
  }
  return { rotulo: "Recebendo", tom: "lime", proximoPasso: null };
}

/**
 * Endereço de pré-visualização não serve para o Z-API: ele muda a cada versão
 * e fica atrás de login da Lovable. A URL tem de sair do endereço publicado.
 */
export function origemServeParaWebhook(origem: string): boolean {
  try {
    const { hostname, protocol } = new URL(origem);
    if (protocol !== "https:") return false;
    if (hostname === "localhost" || hostname.startsWith("127.")) return false;
    if (hostname.startsWith("id-preview--") || hostname.includes("lovableproject")) return false;
    return true;
  } catch {
    return false;
  }
}
