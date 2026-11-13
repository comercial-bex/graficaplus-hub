import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { definirTipoDoLead } from "@/lib/api/origem-do-contato.functions";
import {
  AVISO_DA_ETIQUETA,
  frasesDaOrigemDoTipo,
  type OrigemDoTipo,
  type TipoDeContato,
} from "@/domain/whatsapp/origem-do-contato";

type Props = {
  conversaId: string;
  leadId: string | null;
  tipo: TipoDeContato | null;
  tipoOrigem: OrigemDoTipo | null;
  anuncioNome?: string | null;
  produto?: string | null;
  clienteCadastrado?: boolean;
  /** Cliente cadastrado que é parceiro ativo (só informa; nada aqui muda cadastro). */
  parceiroCadastrado?: boolean;
  somenteLeitura?: boolean;
  aoMudar?: () => void;
};

const OPCOES: { valor: TipoDeContato; rotulo: string }[] = [
  { valor: "cliente_final", rotulo: "Cliente final" },
  { valor: "parceiro", rotulo: "Parceiro" },
];

/**
 * Etiqueta interna do tipo do contato, para a equipe. Nada daqui chega ao
 * contato: não há caminho deste componente para mensagem, modelo ou documento.
 * Não altera preço nem cadastro de parceiro.
 */
export function EtiquetaDeTipoDoContato({
  conversaId,
  leadId,
  tipo,
  tipoOrigem,
  anuncioNome,
  produto,
  clienteCadastrado = false,
  parceiroCadastrado = false,
  somenteLeitura = false,
  aoMudar,
}: Props) {
  const gravar = useServerFn(definirTipoDoLead);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoTirar, setConfirmandoTirar] = useState(false);

  async function marcar(novo: TipoDeContato | null) {
    setSalvando(true);
    setErro(null);
    try {
      await gravar({ data: { conversaId, tipo: novo } });
      setConfirmandoTirar(false);
      aoMudar?.();
      toast.success(novo ? "Etiqueta salva." : "Etiqueta removida.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a etiqueta.");
    } finally {
      setSalvando(false);
    }
  }

  function aoEscolher(valor: TipoDeContato) {
    if (valor === tipo) {
      setConfirmandoTirar(true);
      return;
    }
    void marcar(valor);
  }

  if (clienteCadastrado && !leadId) {
    return (
      <section aria-label="Tipo do contato" className="space-y-1 text-base text-foreground">
        <h3 className="text-base font-semibold">Tipo do contato</h3>
        <p>{parceiroCadastrado ? "Parceiro cadastrado" : "Cliente cadastrado. O preço segue o cadastro."}</p>
        <p className="text-muted-foreground">{AVISO_DA_ETIQUETA}</p>
      </section>
    );
  }

  const frases = frasesDaOrigemDoTipo({ tipo, origem: tipoOrigem, anuncioNome, produto });
  const bloqueado = somenteLeitura || !leadId || salvando;

  return (
    <section aria-label="Tipo do contato" className="space-y-2 text-base text-foreground">
      <h3 className="text-base font-semibold">Tipo do contato</h3>
      <div role="group" aria-label="Tipo do contato" className="grid grid-cols-2 gap-2">
        {OPCOES.map((o) => {
          const ativo = tipo === o.valor;
          return (
            <Button
              key={o.valor}
              type="button"
              variant={ativo ? "default" : "outline"}
              aria-pressed={ativo}
              disabled={bloqueado}
              onClick={() => aoEscolher(o.valor)}
              className="h-11 gap-2 text-base"
            >
              {ativo ? <Check className="size-4" aria-hidden="true" /> : null}
              {o.rotulo}
            </Button>
          );
        })}
      </div>
      {confirmandoTirar ? (
        <div role="alertdialog" aria-label="Tirar a etiqueta" className="flex flex-wrap items-center gap-2">
          <span>Tirar a etiqueta?</span>
          <Button type="button" variant="outline" className="h-11 text-base" disabled={salvando} onClick={() => void marcar(null)}>
            Tirar
          </Button>
          <Button type="button" variant="ghost" className="h-11 text-base" disabled={salvando} onClick={() => setConfirmandoTirar(false)}>
            Manter
          </Button>
        </div>
      ) : null}
      {salvando ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Salvando
        </p>
      ) : null}
      <p>{frases.origem}</p>
      {frases.produto ? <p>{frases.produto}</p> : null}
      {!leadId && !somenteLeitura ? (
        <p className="text-muted-foreground">Esta conversa ainda não tem lead para receber a etiqueta.</p>
      ) : null}
      {erro ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <span>{erro}</span>
        </p>
      ) : null}
      <p className="text-muted-foreground">{AVISO_DA_ETIQUETA}</p>
    </section>
  );
}
