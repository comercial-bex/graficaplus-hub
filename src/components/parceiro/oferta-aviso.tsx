import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
 *
 * Nunca por cima de outro diálogo (02/11/2026): o aviso mora na casca e abria
 * sozinho em qualquer tela — inclusive em cima de "Novo orçamento" ou de
 * "Fazer pedido", com dois modais empilhados. Agora só abre no Início e só
 * quando não há outro diálogo aberto; se houver, espera ele fechar.
 */
const SELETOR_DE_DIALOGO_ABERTO = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function OfertaAviso({ painel }: { painel: PainelDoParceiro }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const noInicio = pathname === "/parceiro" || pathname === "/parceiro/";
  const [fechando, setFechando] = useState(false);
  // Fecha na hora, sem esperar o cache voltar: quem desenha o aviso pode estar
  // segurando uma cópia antiga do painel.
  const [dispensadas, setDispensadas] = useState<string[]>([]);
  const oferta = ofertasParaAvisar(painel.ofertas).find((o) => !dispensadas.includes(o.id));
  const ofertaId = oferta?.id ?? null;

  // "Livre" = nenhum outro diálogo aberto. Depois que o aviso abre, para de
  // conferir: senão ele acharia a si mesmo e se fecharia.
  const [livre, setLivre] = useState(false);
  useEffect(() => {
    if (!ofertaId || !noInicio) {
      setLivre(false);
      return;
    }
    if (livre) return;
    const conferir = () => {
      if (!document.querySelector(SELETOR_DE_DIALOGO_ABERTO)) setLivre(true);
    };
    const primeira = window.setTimeout(conferir, 600);
    const depois = window.setInterval(conferir, 1000);
    return () => {
      window.clearTimeout(primeira);
      window.clearInterval(depois);
    };
  }, [ofertaId, noInicio, livre]);

  if (!oferta || !noInicio || !livre) return null;

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
          <DialogDescription className="text-base text-foreground whitespace-pre-line">
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
