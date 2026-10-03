/**
 * O arquivo que o cliente manda pelo portal: tipo, pasta e nome no armazenamento.
 *
 * O envio tem dois passos, nas duas portas:
 *   1. o arquivo sobe para o Storage numa pasta só do cliente:
 *        portal/<cliente_id>/<os_id ou "sem-os">/<milissegundos>-<nome-seguro>
 *      O cliente logado sobe direto (a policy de storage.objects confere a
 *      pasta); o cliente com link sobe com uma URL assinada que a rota de
 *      servidor gera depois de conferir o link.
 *   2. o banco registra (`portal_registrar_envio` / `portal_link_registrar_envio`):
 *      confere que o objeto EXISTE na pasta certa e grava a linha em `arquivos`
 *      (aparece na ficha da OS, aba Arquivos) ou em `portal_comprovantes` (só o
 *      financeiro vê), mais uma solicitação aberta para a equipe.
 *
 * O formato da pasta é o MESMO regex das funções do banco e da policy — mudou
 * lá, muda aqui (o teste confere os dois lados).
 *
 * Domínio puro.
 */

export type TipoDeEnvio = "arte" | "referencia" | "outro" | "comprovante";

export const TIPOS_DE_ENVIO: { valor: TipoDeEnvio; rotulo: string; ajuda: string }[] = [
  {
    valor: "arte",
    rotulo: "Arte pronta para imprimir",
    ajuda: "O arquivo final, do jeito que deve sair na máquina.",
  },
  {
    valor: "referencia",
    rotulo: "Logo, foto ou referência",
    ajuda: "Material para a equipe montar ou ajustar a arte.",
  },
  { valor: "outro", rotulo: "Outro arquivo", ajuda: "Qualquer outro arquivo do pedido." },
  {
    valor: "comprovante",
    rotulo: "Comprovante de pagamento",
    ajuda: "Vai direto para o financeiro conferir. Não aparece para a produção.",
  },
];

export function tipoDeEnvioValido(valor: unknown): valor is TipoDeEnvio {
  return TIPOS_DE_ENVIO.some((t) => t.valor === valor);
}

/** Comprovante é dinheiro: vai para o bucket que só o financeiro lê. */
export function bucketDoEnvio(tipo: TipoDeEnvio): "arquivos-clientes" | "comprovantes" {
  return tipo === "comprovante" ? "comprovantes" : "arquivos-clientes";
}

/**
 * Teto do navegador. O limite real é o do Storage do projeto (não medido aqui;
 * o padrão do Supabase é 50 MB por arquivo). Conferir antes poupa o cliente de
 * esperar um upload inteiro só para ver o erro no fim.
 */
export const TAMANHO_MAXIMO_MB = 50;
export const TAMANHO_MAXIMO_BYTES = TAMANHO_MAXIMO_MB * 1024 * 1024;

/** Mesmo regex de `portal_gravar_envio` e de `portal_pode_enviar_objeto`. */
export const FORMATO_DO_CAMINHO =
  /^portal\/[0-9a-f-]{36}\/([0-9a-f-]{36}|sem-os)\/[A-Za-z0-9._-]{1,160}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidBemFormado(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/**
 * O nome do arquivo do jeito que o Storage aceita como chave.
 *
 * O Storage recusa acento e boa parte da pontuação na chave ("Invalid key"), e
 * cliente manda "Cartão São João (final).PDF". O nome original continua
 * guardado em `arquivos.nome` — aqui é só a chave da pasta.
 */
export function nomeSeguro(nome: string): string {
  const semAcento = nome.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const ponto = semAcento.lastIndexOf(".");
  const temExtensao = ponto > 0 && /^[A-Za-z0-9]{1,10}$/.test(semAcento.slice(ponto + 1));
  const base = temExtensao ? semAcento.slice(0, ponto) : semAcento;
  const extensao = temExtensao ? semAcento.slice(ponto + 1).toLowerCase() : "";

  const limpa = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100)
    .replace(/[-._]+$/g, "");

  const corpo = limpa || "arquivo";
  return extensao ? `${corpo}.${extensao}` : corpo;
}

/** A chave do objeto no Storage. `agora` vem de fora nos testes. */
export function caminhoDoEnvio(params: {
  clienteId: string;
  osId: string | null;
  nome: string;
  agora?: Date;
}): string {
  const ms = (params.agora ?? new Date()).getTime();
  return `portal/${params.clienteId}/${params.osId ?? "sem-os"}/${ms}-${nomeSeguro(params.nome)}`;
}

/**
 * O que impede o envio antes de sair do navegador. `null` quando está tudo
 * certo. O banco confere de novo — esta é a conferência que poupa espera.
 */
export function problemaNoEnvio(params: {
  tipo: TipoDeEnvio | null | undefined;
  osId: string | null | undefined;
  arquivo: { name: string; size: number } | null | undefined;
  mensagem?: string | null;
}): string | null {
  if (!params.tipo || !tipoDeEnvioValido(params.tipo)) return "Diga o que é o arquivo.";
  if (!params.osId && params.tipo !== "comprovante") {
    return "Escolha a qual pedido (OS) o arquivo pertence.";
  }
  if (!params.arquivo) return "Escolha o arquivo.";
  if (params.arquivo.size <= 0) return "O arquivo está vazio.";
  if (params.arquivo.size > TAMANHO_MAXIMO_BYTES) {
    return `Arquivo maior que ${TAMANHO_MAXIMO_MB} MB. Mande por um link (Google Drive, WeTransfer) na mensagem.`;
  }
  if (params.arquivo.name.trim().length > 200)
    return "Nome do arquivo longo demais. Renomeie e tente de novo.";
  if ((params.mensagem ?? "").length > 1000)
    return "Mensagem longa demais: o limite é 1.000 caracteres.";
  return null;
}

/* ------------------------------------------------------------------------- */
/* Mensagem para a equipe                                                     */
/* ------------------------------------------------------------------------- */

export type TipoDeMensagem = "duvida" | "alteracao" | "entrega" | "outro";

/** Os mesmos de `portal_gravar_mensagem`. "pagamento" fica de fora: é o comprovante. */
export const TIPOS_DE_MENSAGEM: { valor: TipoDeMensagem; rotulo: string }[] = [
  { valor: "duvida", rotulo: "Dúvida" },
  { valor: "alteracao", rotulo: "Pedir alteração" },
  { valor: "entrega", rotulo: "Entrega ou retirada" },
  { valor: "outro", rotulo: "Outro assunto" },
];

export function tipoDeMensagemValido(valor: unknown): valor is TipoDeMensagem {
  return TIPOS_DE_MENSAGEM.some((t) => t.valor === valor);
}

export function problemaNaMensagem(texto: string): string | null {
  const t = texto.trim();
  if (t.length < 3) return "Escreva a mensagem antes de enviar.";
  if (t.length > 1000) return "Mensagem longa demais: o limite é 1.000 caracteres.";
  return null;
}
