import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { marcarOfertaVista } from "@/lib/parceiro-api";
import { ofertasParaAvisar, resumoDaOferta, type PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * A oferta que abre sozinha quando o parceiro entra.
 *
 * Uma de cada vez, e só uma vez: fechar marca como vista no banco. O aviso que
 * volta toda vez que a pessoa abre o painel vira ruído e ela aprende a fechar sem
 * ler — que é o contrário do que a oferta precisa.
 */
export function OfertaAviso({ painel }: { painel: PainelDoParceiro }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [fechando, setFechando] = useState(false);
  // Fecha na hora, sem esperar o cache voltar: quem desenha o aviso pode estar
  // segurando uma cópia antiga do painel.
  const [dispensadas, setDispensadas] = useState<string[]>([]);
  const oferta = ofertasParaAvisar(painel.ofertas).find((o) => !dispensadas.includes(o.id));

  if (!oferta) return null;

  async function fechar(irParaTabela: boolean) {
    if (!oferta || fechando) return;
    setFechando(true);
    setDispensadas((lista) => [...lista, oferta.id]);
    // Marca na tela na hora; se o banco falhar, a oferta só reaparece na próxima visita.
    qc.setQueryData<PainelDoParceiro>(["parceiro-painel"], (atual) =>
      atual
        ? { ...atual, ofertas: atual.ofertas.map((o) => (o.id === oferta.id ? { ...o, vista: true } : o)) }
        : atual,
    );
    try {
      await marcarOfertaVista(oferta.id);
    } catch {
      // silencioso de propósito: não vale um erro na cara por causa de um aviso
    } finally {
      setFechando(false);
    }
    if (irParaTabela) navigate({ to: "/parceiro/tabela" });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && fechar(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--bex-magenta)]/15 text-[color:var(--bex-magenta)]">
            <Zap className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl">{oferta.titulo}</DialogTitle>
          <DialogDescription className="text-base text-foreground/80 whitespace-pre-line">
            {oferta.mensagem}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm font-medium">
          {resumoDaOferta(oferta)}
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => fechar(false)} disabled={fechando}>
            Agora não
          </Button>
          {oferta.produto_id && (
            <Button onClick={() => fechar(true)} disabled={fechando}>
              Ver na tabela
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
