import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Paperclip } from "lucide-react";
import { Dica } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { DICAS_WA_MIDIA } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { guardarMidiaDaMensagem } from "@/lib/api/whatsapp-midia.functions";
import { rotuloDoTipo, type MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import {
  categoriaDaMidia,
  nomeParaBaixar,
  precisaArquivar,
  rotuloAcessivelDaMidia,
  temArquivo,
} from "@/domain/whatsapp/midia";
import { indiceDaFoto } from "@/domain/whatsapp/visor";
import { CapaDoDocumento } from "@/components/whatsapp/capa-do-documento";
import { TocadorDeVoz } from "@/components/whatsapp/tocador-de-voz";
import { VisorDeFotos } from "@/components/whatsapp/visor-de-fotos";
import {
  abrirMidia,
  baixarMidia,
  useOrigemDaMidia,
} from "@/components/whatsapp/usar-arquivo-da-midia";

/** Mensagens cuja cópia já foi pedida nesta sessão: abrir de novo não repete. */
const JA_PEDIRAM = new Set<string>();

/**
 * A caixa da foto na bolha: SEMPRE 256 x 256 px (o celular mostra menos: a bolha
 * manda), antes e depois de carregar. O banco não guarda as dimensões da foto;
 * reservar 4:3 e trocar de razão no `onLoad` fazia uma foto em pé pular de 192
 * para 288 px de altura enquanto a pessoa lia mensagens antigas (revisão da
 * onda 1, 12/11/2026). A foto inteira aparece (object-contain) e o visor abre
 * ao tocar.
 */
const LADO_DA_FOTO = "size-64";

/** O espaço do cartão do documento enquanto o link do arquivo não chega: a altura do cartão pronto (ver capa-do-documento.tsx). */
const ALTURA_DO_CARTAO_DE_DOCUMENTO = "h-[306px] w-72";

/** Botão de texto da mídia, sobre a cor da bolha: 44 px de alto e letra do próprio tema da bolha. */
const BOTAO_SOBRE_A_BOLHA =
  "h-11 gap-2 px-3 text-sm text-(--chat-texto) hover:bg-transparent hover:text-(--chat-texto) hover:underline";

/**
 * A mídia de uma mensagem do WhatsApp, dentro da bolha (onda 1, 12/11/2026):
 * a foto aparece (e abre no visor com setas), o vídeo toca ali mesmo, a voz
 * tem tocador próprio, o documento vira um cartão com a capa da 1ª página, a
 * figurinha aparece sem moldura. A legenda fica por conta de quem desenha a
 * bolha (`ConteudoDaBolha`), embaixo da mídia.
 *
 * A fonte é a nossa cópia (link assinado, não vence) ou, enquanto ela não
 * existe, o link do Z-API (vale 30 dias). Mensagem que chegou só com o link é
 * copiada sozinha na primeira abertura (`guardarMidiaDaMensagem`), para o
 * arquivo não sumir do histórico.
 *
 * Todo tipo reserva o espaço antes de carregar (a conversa não pula) e chama
 * `aoMudarAltura` quando carrega. Sem arquivo não desenha nada. Se o arquivo
 * não carrega (link vencido, voz em formato que o aparelho não toca), a bolha
 * diz isso e o "Baixar" segue ali: falha não pode se ler como "não tinha mídia".
 */
export function MidiaDaMensagem({
  m,
  aoMudarAltura,
  aoArquivar,
  fotos,
  gif,
  segundos,
}: {
  m: MensagemDaCaixa;
  /** A mídia carregou e a bolha cresceu: quem rola a conversa mantém o fim à vista. */
  aoMudarAltura?: () => void;
  /** A cópia foi feita: quem lista as mensagens recarrega. */
  aoArquivar?: () => void;
  /** As fotos da conversa, para o visor andar entre elas (`fotosDaConversa`). */
  fotos?: readonly MensagemDaCaixa[];
  /** Para a onda seguinte: o Z-API diz que a imagem é um GIF (ainda não gravado). */
  gif?: boolean;
  /** Para a onda seguinte: a duração que o Z-API informa (ainda não gravada). */
  segundos?: number;
}) {
  const categoria = categoriaDaMidia(m.tipo);
  const [falhou, setFalhou] = useState(false);
  const [semFormato, setSemFormato] = useState(false);
  const [visor, setVisor] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const guardar = useServerFn(guardarMidiaDaMensagem);

  const { naCopia, origem, aguardando, semLink, erroDoLink } = useOrigemDaMidia(m);

  // O link do Z-API vence em 30 dias: copia para o nosso armazenamento agora.
  const deveArquivar = precisaArquivar(m);
  useEffect(() => {
    if (!deveArquivar || JA_PEDIRAM.has(m.id)) return;
    JA_PEDIRAM.add(m.id);
    guardar({ data: { mensagemId: m.id } })
      .then((r) => {
        if (r.ok) aoArquivar?.();
        else console.warn("[whatsapp] a cópia da mídia não foi feita:", r.erro);
      })
      .catch((e: unknown) => console.warn("[whatsapp] a cópia da mídia falhou:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deveArquivar, m.id]);

  if (!temArquivo(m) || categoria === "outra") return null;

  const nome = nomeParaBaixar(m);
  const rotulo = rotuloDoTipo(m.tipo).toLowerCase();
  const ehFigurinha = m.tipo === "sticker";

  async function baixar() {
    setBaixando(true);
    try {
      await baixarMidia(m, nome);
    } finally {
      setBaixando(false);
    }
  }

  const quebrou = falhou || semLink || semFormato;

  const botaoBaixar = (
    <Dica texto={DICAS_WA_MIDIA.baixar}>
      <Button
        type="button"
        variant="ghost"
        className={BOTAO_SOBRE_A_BOLHA}
        onClick={baixar}
        disabled={baixando}
        aria-label={`Baixar ${rotulo}`}
      >
        {baixando ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Baixar
      </Button>
    </Dica>
  );

  const botaoAbrir = (
    <Dica texto={DICAS_WA_MIDIA.abrir}>
      <Button
        type="button"
        variant="ghost"
        className={BOTAO_SOBRE_A_BOLHA}
        onClick={() => void abrirMidia(m)}
        aria-label={`Abrir ${rotulo} em outra aba`}
      >
        <Paperclip aria-hidden /> Abrir
      </Button>
    </Dica>
  );

  const listaDoVisor = fotos && indiceDaFoto(fotos, m.id) >= 0 ? fotos : [m];

  let corpo: React.ReactNode;
  if (quebrou) {
    corpo = (
      <div
        role="alert"
        className="max-w-72 rounded-lg border border-dashed border-current px-3 py-2 text-sm text-(--chat-texto)"
      >
        {semLink
          ? `Não foi possível abrir o arquivo guardado (${mensagemErro(erroDoLink)}).`
          : semFormato
            ? "Este aparelho não toca este áudio (formato Ogg Opus). Toque em Baixar para ouvir em outro programa."
            : naCopia
              ? "Este arquivo não abre aqui. Toque em Baixar para tentar."
              : "Este arquivo não abre aqui. Se ele for antigo, o link do WhatsApp pode ter vencido (vale 30 dias). Toque em Baixar para tentar."}
      </div>
    );
  } else if (aguardando || !origem) {
    // Espaço reservado do tamanho da mídia que vem.
    const reserva =
      categoria === "documento"
        ? ALTURA_DO_CARTAO_DE_DOCUMENTO
        : categoria === "audio"
          ? "h-14 w-72"
          : categoria === "video"
            ? "aspect-video w-72"
            : ehFigurinha
              ? "size-40"
              : LADO_DA_FOTO;
    corpo = (
      <div
        className={`flex max-w-full items-center justify-center gap-2 rounded-lg bg-(--midia-cartao) px-3 text-sm text-(--midia-cartao-apoio) ${reserva}`}
      >
        <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando {rotulo}
      </div>
    );
  } else if (categoria === "imagem" && ehFigurinha) {
    corpo = (
      <img
        src={origem}
        alt={m.legenda?.trim() || "Figurinha do WhatsApp"}
        loading="lazy"
        onLoad={aoMudarAltura}
        onError={() => setFalhou(true)}
        className="size-40 object-contain"
      />
    );
  } else if (categoria === "imagem") {
    corpo = (
      <>
        <button
          type="button"
          onClick={() => setVisor(true)}
          className={`relative block ${LADO_DA_FOTO} max-w-full overflow-hidden rounded-lg bg-(--midia-cartao) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          aria-label={`Ampliar ${rotulo}`}
        >
          <img
            src={origem}
            alt={m.legenda?.trim() || `${rotuloDoTipo(m.tipo)} do WhatsApp`}
            loading="lazy"
            onLoad={aoMudarAltura}
            onError={() => setFalhou(true)}
            className="h-full w-full object-contain"
          />
          {gif && (
            <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
              GIF
            </span>
          )}
        </button>
        <VisorDeFotos
          fotos={listaDoVisor}
          indiceInicial={Math.max(0, indiceDaFoto(listaDoVisor, m.id))}
          aberto={visor}
          aoFechar={() => setVisor(false)}
        />
      </>
    );
  } else if (categoria === "video") {
    corpo = (
      <div className="aspect-video w-72 max-w-full overflow-hidden rounded-lg bg-black">
        <video
          src={origem}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={aoMudarAltura}
          onError={() => setFalhou(true)}
          className="h-full w-full object-contain"
        />
      </div>
    );
  } else if (categoria === "audio") {
    corpo = (
      <TocadorDeVoz
        origem={origem}
        nome={nome}
        segundos={segundos}
        aoMudarAltura={aoMudarAltura}
        aoFalhar={(formato) => (formato ? setSemFormato(true) : setFalhou(true))}
      />
    );
  } else {
    corpo = (
      <CapaDoDocumento
        mensagemId={m.id}
        nome={nome}
        origem={origem}
        gif={gif}
        segundos={segundos}
        baixando={baixando}
        aoBaixar={baixar}
        aoAbrir={() => void abrirMidia(m)}
        aoMudarAltura={aoMudarAltura}
      />
    );
  }

  // O cartão do documento já traz Abrir e Baixar; foto abre no visor, que baixa.
  const comBotoesProprios =
    !quebrou &&
    !aguardando &&
    origem &&
    (categoria === "documento" || (categoria === "imagem" && !ehFigurinha));

  return (
    <div
      className="space-y-1"
      data-midia={categoria}
      role="group"
      aria-label={rotuloAcessivelDaMidia(m)}
    >
      {corpo}
      {!comBotoesProprios && (
        <div className="flex flex-wrap items-center">
          {botaoBaixar}
          {quebrou && botaoAbrir}
        </div>
      )}
    </div>
  );
}
