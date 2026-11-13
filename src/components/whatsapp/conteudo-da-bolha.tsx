import { cn } from "@/lib/utils";
import type { MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { legendaDaBolha, temArquivo } from "@/domain/whatsapp/midia";
import { semAssinatura } from "@/domain/whatsapp/assistente";
import { partesComRealce } from "@/domain/whatsapp/linha-do-tempo";
import { MidiaDaMensagem } from "@/components/whatsapp/midia-da-mensagem";

/**
 * O que vai DENTRO da bolha: o texto e a mídia. Dono: MIDIA (onda 1,
 * 12/11/2026). A bolha em volta (fundo, lado, nome de quem mandou, hora,
 * tique, "Tentar de novo") é da CONVERSA, que só desenha
 * `<ConteudoDaBolha m={m} ... />` e não olha o que vai aqui dentro.
 *
 * Mídia em cima e legenda embaixo, como no WhatsApp. O "[Documento]" e o
 * "[Imagem]" não aparecem quando a mídia aparece (o tipo fica no `aria-label`
 * da mídia); a legenda igual ao nome do arquivo não se repete; mídia sem
 * arquivo diz uma frase clara (`legendaDaBolha`, em domain/whatsapp/midia.ts).
 * Texto de 16 px. A figurinha é só a imagem: quem desenha a bolha pergunta
 * `bolhaSemFundo(m)` e não pinta o fundo.
 */
export type PropsDoConteudoDaBolha = {
  m: MensagemDaCaixa;
  /** A mídia carregou e a bolha mudou de altura: quem rola a conversa mantém o fim à vista. */
  aoMudarAltura?: () => void;
  /** A cópia da mídia foi feita: quem lista as mensagens recarrega. */
  aoArquivar?: () => void;
  /**
   * As fotos carregadas da conversa (`fotosDaConversa`, de midia.ts), da mais
   * antiga para a mais nova: o visor de fotos anda entre elas com as setas.
   * Sem a lista, o visor mostra só a foto desta bolha.
   */
  fotos?: readonly MensagemDaCaixa[];
  /** O termo da busca na conversa: os trechos do texto que casam vêm marcados. */
  realce?: string | null;
};

export function ConteudoDaBolha({ m, aoMudarAltura, aoArquivar, fotos, realce }: PropsDoConteudoDaBolha) {
  const temMidia = temArquivo(m);
  const naoSuportada = m.tipo === "sistema" && !m.texto;
  const legenda = legendaDaBolha(m);
  const texto = m.origem === "ia" ? semAssinatura(legenda) : legenda;
  return (
    <>
      {temMidia && (
        <MidiaDaMensagem m={m} aoMudarAltura={aoMudarAltura} aoArquivar={aoArquivar} fotos={fotos} />
      )}
      {texto && (
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-base leading-snug",
            temMidia && "mt-1.5",
            naoSuportada && "italic",
          )}
        >
          {partesComRealce(texto, realce).map((p, i) =>
            p.realce ? (
              <mark key={i} className="rounded-sm bg-(--chat-realce) text-(--chat-texto)">
                {p.texto}
              </mark>
            ) : (
              <span key={i}>{p.texto}</span>
            ),
          )}
        </div>
      )}
    </>
  );
}
